import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { Card, Button, TextField, BackLink } from '../ui';
import { FieldRow, FieldRowsEditor } from '../QcWriteTestPanel';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Real business-key sets already established this session (qc-rest.service.ts's
// TIER2_FIELD_PARAM_KEYS / TIER2_REF_FIELD_PARAM_KEYS) — kept in sync by hand
// since the backend allowlist is server-side anyway (this is just what the
// form offers, not what's actually permitted).
const SEVERITY_OPTIONS = ['Show Stopper', 'Severe', 'Medium', 'Low'];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const BUG_TYPE_OPTIONS = ['Functional', 'Change Requests', 'Design', 'Crash', 'GUI', 'Information', 'Configuration', 'Security', 'DB Issue', 'Environment issue', 'Performance'];
const TEST_PHASE_OPTIONS = ['System Test', 'Integration Test', 'Regression Test', 'Sanity Test', 'UAT', 'Production'];
// The 6 real environment names the user confirmed (2026-09-22) — not the ~40
// messy historical values found in real seed data, which turned out to be
// closer to free text than a clean picklist.
const ENVIRONMENT_OPTIONS = ['Production', 'Test', 'Integration', 'Plike', 'Dev', 'Train'];

interface RefValue { id: string; label: string; }
interface CrOption { id: string; label: string; }
interface ResponsibilityOption { teamId: string; teamName: string; qcResponsibilityValue: string; environmentComponents: string[]; }
interface TeamMemberRow { userId: string; user: { id: string; fullName: string } }
interface VersionOption { id: string; name: string; status: string; }

// Section box, symmetric with its siblings via the parent grid's row-stretch
// — same visual language as the approved mockup
// (https://claude.ai/artifact/AiqwpAcgZrX39jUQA7YiwR, co-designed with the
// user across several rounds — see project-defect-create-form-redesign-
// 2026-09-22 memory for the full history of what was tried and rejected).
const SectionBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Card style={{ height: '100%' }}>
    <div className="mb-3 text-sm font-bold text-foreground">{title}</div>
    <div className="flex flex-wrap items-end gap-4" style={{ direction: 'ltr', justifyContent: 'flex-start' }}>
      {children}
    </div>
  </Card>
);

// Compact by default (shrinks to its select/input's own content width, per
// the user's explicit "field width should match value width" correction);
// pass `full` for the handful of genuinely long fields (CR reference,
// Responsibility, Assigned To, Defect ID placeholder).
const Field: React.FC<{ label: string; hint?: string; full?: boolean; children: React.ReactNode }> = ({ label, hint, full, children }) => (
  <div className="flex flex-col gap-1.5" style={full ? { flex: '1 1 100%' } : undefined}>
    <label className="flex items-baseline gap-1.5 text-xs font-bold text-subtle-foreground" style={{ direction: 'ltr', textAlign: 'left' }}>
      {label}
      {hint && <span className="text-[11px] font-normal text-subtle-foreground/70">{hint}</span>}
    </label>
    {children}
  </div>
);

const selectClass = "rounded-sm border border-border bg-card px-2.5 py-2 text-[13px] text-foreground";
const autoRowClass = "inline-flex items-center gap-2 rounded-sm border border-dashed border-border bg-muted px-3 py-2 text-[13px]";

interface Props {
  token: string;
  initialVersionId?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}

// The real create-defect form (2026-09-22), replacing the old generic
// Tier2-grid CreateDefectModal — a full page, not a modal, because the
// whole point of this redesign was "fill the page" (the modal's fixed
// width was exactly what the user rejected first). Fields are ordered to
// "tell the story" (co-designed with the user via an interactive mockup,
// several corrected rounds — see project-defect-create-form-redesign-
// 2026-09-22 memory): Title, then גילוי/זיהוי/אחריות as three symmetric
// boxes matching DefectDetailScreen's own real section names, then
// Description/Comments.
export const CreateDefectScreen: React.FC<Props> = ({ token, initialVersionId, onBack, onCreated }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const currentUserName = localStorage.getItem('deploycenter_fullName') || '';

  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [versionId, setVersionId] = useState<string>(initialVersionId || '');
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [targetRelease, setTargetRelease] = useState<RefValue | null>(null);
  const [currentCycle, setCurrentCycle] = useState<{ cycleType: string; qcCycleId: string | null; label: string } | null>(null);
  const [crOptions, setCrOptions] = useState<CrOption[]>([]);
  const [crId, setCrId] = useState('');

  const [responsibilityOptions, setResponsibilityOptions] = useState<ResponsibilityOption[]>([]);
  const [teamId, setTeamId] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [memberId, setMemberId] = useState('');

  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('Severe');
  const [priority, setPriority] = useState('Medium');
  const [bugType, setBugType] = useState('Functional');
  const [testPhase, setTestPhase] = useState('System Test');
  const [environment, setEnvironment] = useState('Test');
  const [envComponent, setEnvComponent] = useState('');
  const [description, setDescription] = useState('');
  const [comments, setComments] = useState('');
  const [extraRows, setExtraRows] = useState<FieldRow[]>([{ name: '', value: '' }]);
  // Attachments (2026-09-22, user request: "חסר אפשרות לצרף קבצים") — can
  // only upload AFTER the defect exists in QC (attachments hang off a real
  // defect id), so these just sit as pending File objects until submit()
  // creates the defect, then get uploaded one by one against its real id.
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [failedFiles, setFailedFiles] = useState<{ file: File; message: string }[]>([]);
  const [createdIdPendingAttachments, setCreatedIdPendingAttachments] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every version still "in flight" (past CR-list import, not yet closed
  // out) — the pool the "Detected in Release" picker offers, per the
  // original requirement ("אוטומטי בהתאם לגרסה הפעילה, אם יש יותר מאחת
  // תפתח רשימה לבחירה"). DRAFT is excluded: a version that hasn't even
  // collected its CR list yet can't have real QaAssignment rows to test
  // "my CRs in this release" against.
  useEffect(() => {
    axios.get(`${API}/versions`, { headers })
      .then(r => {
        const inFlight = (r.data ?? []).filter((v: any) =>
          !['DRAFT', 'COMPLETED', 'ROLLED_BACK'].includes(v.status),
        );
        setVersions(inFlight.map((v: any) => ({ id: v.id, name: v.name, status: v.status })));
        if (!versionId && inFlight.length > 0) setVersionId(inFlight[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDefaults = useCallback((vId: string) => {
    if (!vId) return;
    setDefaultsLoading(true);
    axios.get(`${API}/release-intelligence/defect-create-defaults/${vId}`, { headers })
      .then(r => {
        setTargetRelease(r.data?.targetRelease ?? null);
        setCurrentCycle(r.data?.currentCycle ?? null);
        setCrOptions(r.data?.crOptions ?? []);
        setCrId('');
        setTeamId(''); setResponsibilityOptions([]); setTeamMembers([]); setMemberId('');
      })
      .catch(() => { setTargetRelease(null); setCurrentCycle(null); setCrOptions([]); })
      .finally(() => setDefaultsLoading(false));
  }, [headers]);

  useEffect(() => { if (versionId) loadDefaults(versionId); }, [versionId, loadDefaults]);

  const onCrChange = (newCrId: string) => {
    setCrId(newCrId);
    setTeamId(''); setTeamMembers([]); setMemberId(''); setEnvComponent('');
    if (!newCrId) { setResponsibilityOptions([]); return; }
    axios.get(`${API}/release-intelligence/defect-create-responsibility-options/${versionId}/${encodeURIComponent(newCrId)}`, { headers })
      .then(r => {
        const opts: ResponsibilityOption[] = r.data ?? [];
        setResponsibilityOptions(opts);
        if (opts.length === 1) onTeamChange(opts[0].teamId, opts);
      })
      .catch(() => setResponsibilityOptions([]));
  };

  const onTeamChange = (newTeamId: string, opts: ResponsibilityOption[] = responsibilityOptions) => {
    setTeamId(newTeamId);
    setMemberId('');
    const teamOpt = opts.find(o => o.teamId === newTeamId);
    setEnvComponent(teamOpt?.environmentComponents[0] ?? '');
    if (!newTeamId) { setTeamMembers([]); return; }
    axios.get(`${API}/teams/${newTeamId}`, { headers })
      .then(r => setTeamMembers(r.data?.members ?? []))
      .catch(() => setTeamMembers([]));
  };

  const selectedTeamOption = responsibilityOptions.find(o => o.teamId === teamId) || null;
  const canSubmit = title.trim().length > 0 && !creating;

  const submit = async () => {
    if (!title.trim()) { setError('יש להזין כותרת (Summary)'); return; }
    setCreating(true); setError(null);
    try {
      const businessFields: Record<string, string> = { severity, priority, bugType, testPhase, environment };
      if (envComponent) businessFields.environmentComponent = envComponent;
      if (selectedTeamOption) businessFields.responsibility = selectedTeamOption.qcResponsibilityValue;
      if (crId) businessFields.crHbrReference = crId === 'regression' || crId === 'production'
        ? crId.charAt(0).toUpperCase() + crId.slice(1)
        : crId;

      const businessRefFields: Record<string, RefValue> = {};
      if (targetRelease) businessRefFields.detectedRelease = targetRelease;
      if (currentCycle?.qcCycleId) businessRefFields.detectedCycle = { id: currentCycle.qcCycleId, label: currentCycle.label };

      const rawFields: Record<string, string> = {};
      if (description.trim()) rawFields.description = description.trim();
      if (comments.trim()) rawFields['dev-comments'] = comments.trim();
      for (const row of extraRows) if (row.name.trim()) rawFields[row.name.trim()] = row.value;

      const res = await axios.post(`${API}/qc/defects`, { title: title.trim(), businessFields, businessRefFields, rawFields }, { headers });
      if (!res.data?.id) {
        setError('התקלה נוצרה ב-QC אך לא זוהה מזהה בתשובה — בדוק ידנית ב-QC UI');
        return;
      }
      const newId = res.data.id;

      // Files can only be attached once the defect exists — upload one at a
      // time against the real id we just got back. A failure here doesn't
      // undo the (already-created) defect — but rather than silently
      // navigating away with the failure only visible in a state nobody
      // will see (this screen is about to unmount), stay put and show it,
      // letting the user retry or continue on to the defect regardless.
      if (attachedFiles.length > 0) {
        const failures: { file: File; message: string }[] = [];
        for (const file of attachedFiles) {
          const form = new FormData();
          form.append('file', file);
          try {
            await axios.post(`${API}/qc/defect/${encodeURIComponent(newId)}/attachments`, form, { headers });
          } catch (err: any) {
            failures.push({ file, message: err?.response?.data?.message || 'העלאה נכשלה' });
          }
        }
        if (failures.length > 0) {
          setFailedFiles(failures);
          setCreatedIdPendingAttachments(newId);
          return;
        }
      }

      onCreated(newId);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'יצירת התקלה נכשלה');
    } finally {
      setCreating(false);
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setAttachedFiles(prev => [...prev, ...Array.from(files)]);
  };
  const removeFile = (idx: number) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx));

  const retryAttachments = async () => {
    if (!createdIdPendingAttachments) return;
    setCreating(true);
    const stillFailing: { file: File; message: string }[] = [];
    for (const { file } of failedFiles) {
      const form = new FormData();
      form.append('file', file);
      try {
        await axios.post(`${API}/qc/defect/${encodeURIComponent(createdIdPendingAttachments)}/attachments`, form, { headers });
      } catch (err: any) {
        stillFailing.push({ file, message: err?.response?.data?.message || 'העלאה נכשלה' });
      }
    }
    setFailedFiles(stillFailing);
    setCreating(false);
    if (stillFailing.length === 0) onCreated(createdIdPendingAttachments);
  };

  const memberName = (m: TeamMemberRow) => m.user?.fullName ?? '';
  const selectedCrLabel = crOptions.find(c => c.id === crId)?.label?.split(' — ')[0] ?? '—';
  const selectedMemberName = teamMembers.find(m => m.userId === memberId) ? memberName(teamMembers.find(m => m.userId === memberId)!) : '—';

  return (
    <div className="flex flex-col gap-4 px-7 py-5" dir="rtl">
      <BackLink onClick={onBack} label="חזרה" />

      <Card>
        <div className="flex items-center gap-2.5">
          <span className="text-[22px]">🪲</span>
          <div className="text-lg font-bold text-foreground">תקלה חדשה ב-QC</div>
          <div className="text-xs text-subtle-foreground">
            טופס זה עדיין לא נבדק מול QC אמיתי — ייבדק בהעברת הגרסה הבאה לייצור
          </div>
        </div>
      </Card>

      <div className="rounded-md border border-primary/30 bg-primary-100 px-4 py-3 text-[13px] leading-7 text-foreground">
        📖 <b>תקלה (חדשה)</b> נפתחת בגרסה <b>{versions.find(v => v.id === versionId)?.name ?? '—'}</b>,
        {' '}בסבב <b>{currentCycle?.label ?? '—'}</b>, עבור <b>{selectedCrLabel}</b>.
        {' '}האחראי לטיפול: צוות <b>{selectedTeamOption?.teamName ?? '—'}</b> — <b>{selectedMemberName}</b>
        {title && <> .<br />כותרת: <b>&quot;{title}&quot;</b>, חומרה <b>{severity}</b></>}.
      </div>

      <Card>
        <Field label="Title *" full>
          <TextField value={title} onChange={e => setTitle(e.target.value)} dir="auto" placeholder="כותרת קצרה וברורה של התקלה" fullWidth />
        </Field>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

        <SectionBox title="גילוי">
          <Field label="Detected in Release" hint="(אוטומטי)">
            <select className={selectClass} style={{ direction: 'ltr' }} value={versionId} onChange={e => setVersionId(e.target.value)}>
              {versions.map(v => <option key={v.id} value={v.id}>{v.name} ({v.status})</option>)}
            </select>
          </Field>
          <Field label="Detected in Cycle" hint="(אוטומטי)">
            <div className={autoRowClass} style={{ direction: 'ltr' }}>
              <b>{defaultsLoading ? '…' : (currentCycle?.label ?? '—')}</b>
            </div>
          </Field>
          <Field label="Detected on Date" hint="(אוטומטי)">
            <div className={autoRowClass} style={{ direction: 'ltr' }}><b>{new Date().toLocaleDateString('he-IL')}</b></div>
          </Field>
          <Field label="Detected By" hint="(אוטומטי)">
            <div className={autoRowClass} style={{ direction: 'ltr' }}><b>{currentUserName || '—'}</b></div>
          </Field>
          <Field label="CR / HBR Number reference" hint='* שייך ל"יעד וגרסה" בטופס הקיים — כאן לפי סדר הסיפור' full>
            <select className={selectClass} style={{ direction: 'ltr', width: '100%' }} value={crId} onChange={e => onCrChange(e.target.value)}>
              <option value="" disabled>בחר CR...</option>
              {crOptions.map(cr => <option key={cr.id} value={cr.id}>{cr.label}</option>)}
            </select>
          </Field>
          <Field label="Test Phase">
            <select className={selectClass} style={{ direction: 'ltr' }} value={testPhase} onChange={e => setTestPhase(e.target.value)}>
              {TEST_PHASE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Environment">
            <select className={selectClass} style={{ direction: 'ltr' }} value={environment} onChange={e => setEnvironment(e.target.value)}>
              {ENVIRONMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Environment Component" hint={selectedTeamOption ? `לפי ${selectedTeamOption.teamName}` : 'לפי הצוות'}>
            <select className={selectClass} style={{ direction: 'ltr' }} value={envComponent} onChange={e => setEnvComponent(e.target.value)} disabled={!selectedTeamOption}>
              {!selectedTeamOption && <option value="">— Responsibility —</option>}
              {(selectedTeamOption?.environmentComponents ?? []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </SectionBox>

        <SectionBox title="זיהוי">
          <Field label="Defect ID" hint="(אוטומטי מ-QC)" full>
            <div className={autoRowClass} style={{ direction: 'ltr' }}><span className="text-subtle-foreground">יוקצה עם השמירה</span></div>
          </Field>
          <Field label="Severity">
            <select className={selectClass} style={{ direction: 'ltr' }} value={severity} onChange={e => setSeverity(e.target.value)}>
              {SEVERITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={selectClass} style={{ direction: 'ltr' }} value={priority} onChange={e => setPriority(e.target.value)}>
              {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Bug Type">
            <select className={selectClass} style={{ direction: 'ltr' }} value={bugType} onChange={e => setBugType(e.target.value)}>
              {BUG_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Bug Status" hint="(אוטומטי)">
            <div className="rounded-sm bg-success/15 px-2.5 py-1.5 text-[13px] font-bold text-success">Open</div>
          </Field>
        </SectionBox>

        <SectionBox title="אחריות">
          <Field label="Responsibility" hint={crId ? undefined : 'בחר CR תחילה'} full>
            <select
              className={selectClass} style={{ direction: 'ltr', width: '100%' }}
              value={teamId} onChange={e => onTeamChange(e.target.value)} disabled={!crId || responsibilityOptions.length === 0}
            >
              <option value="">{crId ? (responsibilityOptions.length === 0 ? '— אין צוות ממופה ל-CR זה —' : 'בחר צוות...') : '— בחר CR תחילה —'}</option>
              {responsibilityOptions.map(o => <option key={o.teamId} value={o.teamId}>{o.teamName}</option>)}
            </select>
          </Field>
          <Field label="Assigned To" full>
            <select
              className={selectClass} style={{ direction: 'ltr', width: '100%' }} dir="auto"
              value={memberId} onChange={e => setMemberId(e.target.value)} disabled={!teamId}
            >
              <option value="">{teamId ? 'בחר איש צוות...' : '— בחר Responsibility —'}</option>
              {teamMembers.map(m => <option key={m.userId} value={m.userId}>{memberName(m)}</option>)}
            </select>
          </Field>
        </SectionBox>

      </div>

      <Card>
        <div className="flex flex-col gap-4">
          <Field label="Description" full>
            <textarea
              dir="auto" rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="תיאור מפורט: שלבי שחזור, התנהגות שהתקבלה מול הצפויה"
              className="w-full resize-y rounded-sm border border-border bg-card px-3 py-2 text-[13px] text-foreground"
            />
          </Field>
          <Field label="Comments" full>
            <textarea
              dir="auto" rows={2} value={comments} onChange={e => setComments(e.target.value)}
              placeholder="הערות נוספות (אופציונלי)"
              className="w-full resize-y rounded-sm border border-border bg-card px-3 py-2 text-[13px] text-foreground"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-sm font-bold text-foreground">קבצים מצורפים <span className="text-xs font-normal text-subtle-foreground">(אופציונלי — יועלו ל-QC לאחר יצירת התקלה)</span></div>
        <div className="flex flex-col gap-2">
          {attachedFiles.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-sm border border-border bg-muted px-3 py-1.5 text-[13px]">
              <span dir="auto" className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="flex-shrink-0 text-subtle-foreground">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => removeFile(i)} className="flex-shrink-0 cursor-pointer text-danger">✕</button>
            </div>
          ))}
          <label className="w-fit cursor-pointer rounded-sm border border-dashed border-border px-3 py-2 text-[13px] font-semibold text-primary hover:bg-muted">
            + הוסף קובץ
            <input type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-xs font-semibold text-subtle-foreground">שדות נוספים לפי שם REST (אופציונלי — למשל שדות שעדיין לא ממופים)</div>
        <FieldRowsEditor rows={extraRows} onChange={setExtraRows} />
      </Card>

      {error && <div className="text-[13px] font-semibold text-danger">{error}</div>}

      {createdIdPendingAttachments ? (
        // Reached only when the defect itself was created successfully but
        // one or more attachments failed to upload — don't lose that
        // context by navigating away silently (see submit()'s own comment).
        <Card style={{ borderColor: C.warning }}>
          <div className="mb-2 text-[13px] font-semibold text-warning">
            התקלה {createdIdPendingAttachments} נוצרה בהצלחה, אך {failedFiles.length} קבצים לא הועלו:
          </div>
          <ul className="mb-3 list-inside list-disc text-[13px] text-danger">
            {failedFiles.map((f, i) => <li key={i}>{f.message}</li>)}
          </ul>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => onCreated(createdIdPendingAttachments)}>המשך בלי הקבצים</Button>
            <Button onClick={retryAttachments} disabled={creating}>{creating ? 'מנסה שוב…' : '↺ נסה שוב להעלות'}</Button>
          </div>
        </Card>
      ) : (
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onBack}>ביטול</Button>
          <Button onClick={submit} disabled={!canSubmit}>{creating ? 'יוצר…' : '✓ פתח תקלה ב-QC'}</Button>
        </div>
      )}
    </div>
  );
};
