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
// Excel-import) — used by VersionsView's "יצירת תוכנית הטמעה" and
// HomeDashboard's equivalent buttons, to fill in an already-created version
// (targetVersionId) with dates/phases/tasks. Bare version *creation* itself
// now lives in ניהול גרסה (VersionManagementModuleView's own instance of this
// hook, using createFromCrListName only) — reversing the 2026-07-27 decision
// that had removed it from there (product decision, 2026-09, once ניהול
// גרסה existed as its own module). The create* functions here still accept
// no targetVersionId as a fallback for any caller that needs to create a
// version directly.
export function useVersionCreation(token: string, opts: { onCreated: (versionId: string) => void; onListChanged?: () => void }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [newVersion, setNewVersion] = useState<NewVersionState>(EMPTY_NEW_VERSION);
  const [qcReleases, setQcReleases] = useState<QcRelease[]>([]);
  // Version names already known from CR_LIST (sourced from Clarity) that
  // don't exist as a Version here yet — user's request 2026-09-19: pick a
  // planned/future version by name instead of typing it, so the name matches
  // exactly what Clarity/CR_LIST already calls it (and what will later be
  // used to create the matching Release in QC).
  const [futureVersionNames, setFutureVersionNames] = useState<string[]>([]);
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
    axios.get(`${API}/version-cr-assignments/future-versions`, { headers }).then(res => setFutureVersionNames(res.data)).catch(() => {});
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

  // Bare-minimum creation for "ניהול גרסה"'s own picker — a name from
  // CR_LIST and nothing else. The backend never actually required more than
  // `name` (versions.service.ts::create()); everything else here was only a
  // frontend gate (`formComplete` above), which this path skips entirely by
  // design (product decision reversal, 2026-09 — see plan doc).
  const [creatingMinimal, setCreatingMinimal] = useState(false);
  const createFromCrListName = async (name: string) => {
    if (!name.trim()) return;
    setCreatingMinimal(true);
    try {
      const res = await axios.post(`${API}/versions`, { name: name.trim() }, { headers });
      const versionId = res.data.id;
      syncCrsInBackground(versionId);
      opts.onListChanged?.();
      opts.onCreated(versionId);
    } catch (err: any) { setActionError(err?.response?.data?.message || 'שגיאה ביצירת גרסה'); }
    finally { setCreatingMinimal(false); }
  };

  // Only the fields VersionWizard's later steps actually collect when filling
  // in an already-created version — deliberately excludes name/description
  // (owned by ניהול גרסה's creation step) and qcReleaseId (not even accepted
  // by versions.service.ts::updateFields), so this can never rename or
  // re-describe the version it's patching.
  const datesPayload = () => ({
    plannedStart: newVersion.plannedStart || undefined,
    plannedEnd: newVersion.plannedEnd || undefined,
    reviewMeetingTime: newVersion.reviewMeetingTime || undefined,
    workPlanMeetingTime: newVersion.workPlanMeetingTime || undefined,
    integrationStart: newVersion.integrationStart || undefined,
    integrationEnd: newVersion.integrationEnd || undefined,
    qaStart: newVersion.qaStart || undefined,
    qaEnd: newVersion.qaEnd || undefined,
    plannedRehearsalStart: newVersion.plannedRehearsalStart || undefined,
    plannedRehearsalEnd: newVersion.plannedRehearsalEnd || undefined,
  });

  // targetVersionId: when set, these three fill in an EXISTING version
  // (created via ניהול גרסה's CR_LIST picker) instead of creating a new one —
  // PATCH the dates / apply-to-existing-version, same endpoints VersionsView's
  // own "Empty DRAFT: build deployment plan" panel already uses independent
  // of creation. Omitted, they fall back to the original create-a-new-version
  // behavior (kept for any caller that still needs it).
  const createEmpty = async (targetVersionId?: string) => {
    if (!targetVersionId && !formComplete) return;
    setCreatingTemplate(true);
    try {
      let versionId = targetVersionId;
      if (targetVersionId) {
        await axios.patch(`${API}/versions/${targetVersionId}`, datesPayload(), { headers });
      } else {
        const res = await axios.post(`${API}/versions`, {
          ...newVersion,
          qcReleaseId: newVersion.qcReleaseId || undefined,
        }, { headers });
        versionId = res.data.id;
        syncCrsInBackground(versionId!);
      }
      reset();
      opts.onListChanged?.();
      opts.onCreated(versionId!);
    } catch (err: any) { setActionError(err?.response?.data?.message || 'שגיאה ביצירת גרסה'); }
    finally { setCreatingTemplate(false); }
  };

  const importFromFile = async (targetVersionId?: string) => {
    if (!importFile || (!targetVersionId && !newVersion.name.trim())) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      if (targetVersionId) formData.append('existingVersionId', targetVersionId);
      else formData.append('versionName', newVersion.name);
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

  const createFromTemplate = async (targetVersionId?: string) => {
    if (!selectedTemplateId) { setActionError('יש לבחור תבנית לפני יצירה'); return; }
    if (!targetVersionId) {
      if (!newVersion.name.trim()) { setActionError('נדרש שם גרסה לפני יצירה'); return; }
      if (!newVersion.plannedStart) { setActionError('נדרש תאריך ושעת התחלה מתוכנן לפני יצירה'); return; }
      if (!newVersion.plannedEnd) { setActionError('נדרש תאריך ושעת סיום מתוכנן לפני יצירה'); return; }
    }
    setCreatingFromTemplate(true);
    try {
      let versionId = targetVersionId;
      if (targetVersionId) {
        await axios.patch(`${API}/versions/${targetVersionId}`, datesPayload(), { headers });
      } else {
        const res = await axios.post(`${API}/versions`, {
          ...newVersion,
          qcReleaseId: newVersion.qcReleaseId || undefined,
        }, { headers });
        versionId = res.data.id;
        syncCrsInBackground(versionId!);
      }
      await axios.post(`${API}/version-templates/${selectedTemplateId}/apply-to-version/${versionId}`, {}, { headers });
      reset();
      opts.onListChanged?.();
      opts.onCreated(versionId!);
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'שגיאה ביצירה מתבנית');
    } finally { setCreatingFromTemplate(false); }
  };

  return {
    newVersion, setNewVersion, qcReleases, futureVersionNames, templates, selectedTemplateId, setSelectedTemplateId,
    importFile, setImportFile, handlePlannedStartChange,
    createEmpty, importFromFile, createFromTemplate,
    createFromCrListName, creatingMinimal,
    creatingTemplate, creatingFromTemplate, importing,
    actionError, setActionError, reset,
  };
}
