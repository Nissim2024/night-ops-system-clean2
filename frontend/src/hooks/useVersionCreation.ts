import { useState, useEffect } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

export interface QcRelease {
  id: string; relId: number; relName: string;
  goLiveDate?: string; rehearsalDate?: string; filterDate?: string; relEndDate?: string;
}

export interface NewVersionState {
  name: string; description: string; plannedStart: string; plannedEnd: string;
  reviewMeetingTime: string; workPlanMeetingTime: string;
  integrationStart: string; integrationEnd: string; qaStart: string; qaEnd: string;
  plannedRehearsalStart: string; plannedRehearsalEnd: string;
  qcReleaseId: string;
}

const EMPTY_NEW_VERSION: NewVersionState = {
  name: '', description: '', plannedStart: '', plannedEnd: '', reviewMeetingTime: '', workPlanMeetingTime: '',
  integrationStart: '', integrationEnd: '', qaStart: '', qaEnd: '', plannedRehearsalStart: '', plannedRehearsalEnd: '', qcReleaseId: '',
};

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

// Shared state + handlers behind the VersionWizard UI (manual / from-template /
// Excel-import creation) — used by VersionsView's "יצירת תוכנית הטמעה" and
// HomeDashboard's equivalent buttons (deployments module only; version
// creation was removed from the ניהול גרסה module 2026-07-27).
export function useVersionCreation(token: string, opts: { onCreated: (versionId: string) => void; onListChanged?: () => void }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [newVersion, setNewVersion] = useState<NewVersionState>(EMPTY_NEW_VERSION);
  const [qcReleases, setQcReleases] = useState<QcRelease[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/qc-releases/active`, { headers }).then(res => setQcReleases(res.data)).catch(() => {});
    axios.get(`${API}/version-templates`, { headers }).then(res => setTemplates(res.data)).catch(() => {});
  }, []); // eslint-disable-line

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

  const reset = () => {
    setNewVersion(EMPTY_NEW_VERSION);
    setImportFile(null);
    setSelectedTemplateId('');
    setActionError(null);
  };

  const formComplete = !!(
    newVersion.name.trim() &&
    newVersion.description.trim() &&
    newVersion.integrationStart &&
    newVersion.integrationEnd &&
    newVersion.qaStart &&
    newVersion.qaEnd
  );

  const createEmpty = async () => {
    if (!formComplete) return;
    setCreatingTemplate(true);
    try {
      const res = await axios.post(`${API}/versions`, {
        ...newVersion,
        qcReleaseId: newVersion.qcReleaseId || undefined,
      }, { headers });
      const versionId = res.data.id;
      syncCrsInBackground(versionId);
      reset();
      opts.onListChanged?.();
      opts.onCreated(versionId);
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
      if (newVersion.integrationStart) formData.append('integrationStart', newVersion.integrationStart);
      if (newVersion.integrationEnd) formData.append('integrationEnd', newVersion.integrationEnd);
      if (newVersion.qaStart) formData.append('qaStart', newVersion.qaStart);
      if (newVersion.qaEnd) formData.append('qaEnd', newVersion.qaEnd);
      if (newVersion.plannedRehearsalStart) formData.append('plannedRehearsalStart', newVersion.plannedRehearsalStart);
      if (newVersion.plannedRehearsalEnd) formData.append('plannedRehearsalEnd', newVersion.plannedRehearsalEnd);
      const res = await axios.post(`${API}/import/excel`, formData, { headers });
      if (res.data.success) {
        if (res.data.versionId) syncCrsInBackground(res.data.versionId);
        reset();
        opts.onListChanged?.();
        opts.onCreated(res.data.versionId);
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
      reset();
      opts.onListChanged?.();
      opts.onCreated(versionId);
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'שגיאה ביצירה מתבנית');
    } finally { setCreatingFromTemplate(false); }
  };

  return {
    newVersion, setNewVersion, qcReleases, templates, selectedTemplateId, setSelectedTemplateId,
    importFile, setImportFile, handlePlannedStartChange,
    createEmpty, importFromFile, createFromTemplate,
    creatingTemplate, creatingFromTemplate, importing,
    actionError, setActionError, reset,
  };
}
