import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { C, JIRA } from '../../theme';
import { Card, Button, BackLink } from '../ui';
import { formatDate } from '../../utils/dateFormat';
import { useLeaveGuard, useUnsavedChanges } from '../../context/UnsavedChangesContext';
import {
  DefectFieldCell, DefectFieldsCtx, PersonTeam, ReleaseCycleOptionT, RefValue, TeamEnvComponents, loadReleaseScopedOptions,
} from './OpenProdDefectsView';
import {
  DEFAULT_OPEN_PROD_DETAIL_GROUPS, ATTACHMENTS_FIELD, CREATE_REQUIRED_FIELDS, createFieldsOf, DETAIL_FIELD_LABEL,
} from './openProdDefectsFields';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── New defect (2026-10-09: same structure as the update form) ─────────────
// The panels and field order come from the same admin layout ("תבנית טופס
// תקלה"); every field is the same DefectFieldCell with the same pickers (value
// lists, people + team grouping, release ↔ cycle, team ↔ component). What
// differs is the process:
//   - Detected By / on Date / in Release / in Cycle are filled in for you
//     (you, today, the running version's release and cycle);
//   - the fields QC marks Required carry "*" and must be filled before creating;
//   - fields the layout doesn't mark 🆕 are under "שדות נוספים";
//   - Title, Description, the first comment (required by QC) and files.

type ReleaseContext = {
  date: string; isOpsUser: boolean;
  production: { release: RefValue; cycle: RefValue | null; goLiveDate: string | null } | null;
  testing: { versionId: string; name: string; mine: boolean; release: RefValue | null; cycle: RefValue | null; crs: string[] }[];
};

const REF_KEYS = new Set(['detectedInRelease', 'detectedInCycle', 'targetRelease', 'targetCycle']);
const DETECTION_KEYS = new Set(['detectedBy', 'detectedOnDate']);

interface Props {
  token: string;
  initialVersionId?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}

export const CreateDefectScreen: React.FC<Props> = ({ token, initialVersionId, onBack, onCreated }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // ── the same data the update form loads ────────────────────────────────
  const [panels, setPanels] = useState<{ name: string; fields: string[]; wide?: string[]; create?: string[] }[] | null>(null);
  const [fieldPicklists, setFieldPicklists] = useState<Record<string, string[]>>({});
  const [editable, setEditable] = useState<{ fields: Set<string>; refFields: Set<string>; kinds: Record<string, string> }>({ fields: new Set(), refFields: new Set(), kinds: {} });
  const [personDirectory, setPersonDirectory] = useState<{ login: string; fullName: string }[]>([]);
  const [personTeams, setPersonTeams] = useState<PersonTeam[]>([]);
  const [releaseOptions, setReleaseOptions] = useState<ReleaseCycleOptionT[] | null>(null);
  const [teamEnv, setTeamEnv] = useState<TeamEnvComponents | null>(null);
  const [signature, setSignature] = useState('');

  // ── what the user fills in ─────────────────────────────────────────────
  const [values, setValues] = useState<Record<string, string>>({ severity: 'Severe', priority: 'Medium', detectedOnDate: new Date().toISOString().slice(0, 10) });
  const [refValues, setRefValues] = useState<Record<string, RefValue>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [failedFiles, setFailedFiles] = useState<{ file: File; message: string }[]>([]);
  const [createdIdPendingAttachments, setCreatedIdPendingAttachments] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const outsideCommit = useRef<(() => void) | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    const get = (url: string) => axios.get(`${API}${url}`, { headers }).then(r => r.data);
    get('/qc/defect-form-layout').then(d => setPanels(d?.layout?.panels ?? null)).catch(() => setPanels(null));
    get('/qc/defect-field-picklists').then(d => {
      const out: Record<string, string[]> = {};
      for (const [k, e] of Object.entries<any>(d ?? {})) if (e?.values) out[k] = e.values;
      setFieldPicklists(out);
    }).catch(() => {});
    get('/qc/defect-editable-fields').then(d => setEditable({ fields: new Set(d?.fields ?? []), refFields: new Set(d?.refFields ?? []), kinds: d?.kinds ?? {} })).catch(() => {});
    get('/qc/person-directory').then(d => setPersonDirectory(d ?? [])).catch(() => {});
    get('/qc/person-teams').then(d => setPersonTeams(d ?? [])).catch(() => {});
    get('/qc/release-cycle-options').then(d => setReleaseOptions(d ?? [])).catch(() => setReleaseOptions([]));
    get('/qc/team-environment-components').then(d => setTeamEnv(d ?? null)).catch(() => {});
    // you = Detected By (name + login from your QC signature)
    get('/qc/comment-signature').then(d => {
      const sig = String(d?.signature ?? '');
      setSignature(sig);
      const m = /^(.*)\s<([^>]+)>/.exec(sig);
      if (m) setValues(v => (v.detectedBy ? v : { ...v, detectedBy: `${m[1].trim()} (${m[2].trim()})` }));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Which release the defect belongs to (user, 2026-10-09) ──────────────
  // No testing/production switch: a production Environment ("4 - Production",
  // anything with "prod") → the release in production on the detection date,
  // cycle Go Live; otherwise the version in testing — the one the form was
  // opened from, the only one, the one the CR belongs to, or the tester's own
  // — else the user picks. An OPS-team user starts in production. A manual
  // pick is kept until the Environment switches between test and production.
  const [relCtx, setRelCtx] = useState<ReleaseContext | null>(null);
  const [relReason, setRelReason] = useState<string>('');
  const [releaseManual, setReleaseManual] = useState(false);
  const isProd = /prod/i.test(values.environment ?? '');
  const detectionDay = (values.detectedOnDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  useEffect(() => {
    axios.get(`${API}/qc/defect-release-context`, { headers, params: { date: detectionDay } })
      .then(r => setRelCtx(r.data ?? null)).catch(() => setRelCtx(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionDay]);
  // operations people open production defects
  const opsDefaulted = useRef(false);
  useEffect(() => {
    if (!relCtx || opsDefaulted.current) return;
    opsDefaulted.current = true;
    if (relCtx.isOpsUser && !values.environment) {
      const envList = fieldPicklists.environment ?? [];
      const prodValue = envList.find(v => /^\s*4\s*-\s*production\s*$/i.test(v)) ?? '4 - Production';
      setValues(v => ({ ...v, environment: prodValue }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relCtx]);
  // switching between test and production re-picks the release
  const lastMode = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastMode.current !== null && lastMode.current !== isProd) setReleaseManual(false);
    lastMode.current = isProd;
  }, [isProd]);
  const cr = values.crHbrNumberReference ?? '';
  useEffect(() => {
    if (!relCtx || releaseManual) return;
    const apply = (rel: RefValue | null, cyc: RefValue | null, reason: string) => {
      setRefValues(rv => {
        const next = { ...rv };
        if (rel) next.detectedInRelease = rel; else delete next.detectedInRelease;
        if (cyc) next.detectedInCycle = cyc; else delete next.detectedInCycle;
        return next;
      });
      setRelReason(reason);
    };
    if (isProd) {
      const p = relCtx.production;
      apply(p?.release ?? null, p?.cycle ?? null, p
        ? `תקלת ייצור — הגרסה שבייצור ב-${formatDate(relCtx.date)}${p.goLiveDate ? ` (עלתה ${formatDate(p.goLiveDate)})` : ''}`
        : 'לא נמצאה גרסה שעלתה לייצור עד תאריך הגילוי — בחר גרסה');
      return;
    }
    const withRel = relCtx.testing.filter(t => t.release);
    // testing: the release only — several cycles can run in parallel, so the
    // user picks the cycle (user, 2026-10-09); production keeps Go Live
    const pick = (t: ReleaseContext['testing'][number], reason: string) => apply(t.release, null, reason);
    const byCr = cr ? withRel.find(t => t.crs.includes(cr)) : undefined;
    const opened = initialVersionId ? withRel.find(t => t.versionId === initialVersionId) : undefined;
    const mine = withRel.filter(t => t.mine);
    if (byCr) pick(byCr, `ה-CR שנבחר שייך ל-${byCr.name}`);
    else if (opened) pick(opened, 'הגרסה שממנה נפתח הטופס');
    else if (withRel.length === 1) pick(withRel[0], 'הגרסה היחידה בבדיקות');
    else if (mine.length === 1) pick(mine[0], 'הגרסה שבה אתה משובץ לבדיקות');
    else apply(null, null, withRel.length
      ? `יש ${withRel.length} גרסאות בבדיקות (${withRel.map(t => t.name).join(', ')}) — בחר CR או גרסה`
      : 'אין גרסה בבדיקות — בחר גרסה');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relCtx, isProd, cr, releaseManual]);

  const groups = useMemo(() => (panels ?? DEFAULT_OPEN_PROD_DETAIL_GROUPS.map(g => ({ name: g.title, fields: g.fields, wide: g.wide })))
    .map(p => ({ ...p, fields: p.fields.filter(f => f !== ATTACHMENTS_FIELD) })), [panels]);
  const shownPanels = groups.map(p => ({ ...p, fields: createFieldsOf(p) })).filter(p => p.fields.length > 0);
  const shownSet = new Set(shownPanels.flatMap(p => p.fields));
  // required fields the layout left out still have to be there
  const requiredOutside = Array.from(CREATE_REQUIRED_FIELDS).filter(f => !shownSet.has(f));
  const moreFields = groups.flatMap(p => p.fields).filter(f => !shownSet.has(f) && !CREATE_REQUIRED_FIELDS.has(f) && f !== 'id');

  const me = (() => { try { return localStorage.getItem('deploycenter_fullName') ?? ''; } catch { return ''; } })();
  const valueOf = (k: string) => (k === 'status' ? 'New' : k === 'id' ? ''
    : REF_KEYS.has(k) ? (refValues[k]?.label ?? '')
    : k === 'detectedBy' ? (values.detectedBy || me)   // the server writes you when nothing is chosen
    : (values[k] ?? ''));
  const isEditable = (k: string) => k !== 'status' && k !== 'id' && (REF_KEYS.has(k) ? editable.refFields.has(k) : editable.fields.has(k));
  const ctx: DefectFieldsCtx = {
    valueOf,
    isDirty: () => false,
    isEditable,
    lockReason: k => (k === 'status' ? 'נקבע ב-QC בפתיחת התקלה'
      : k === 'id' ? 'יוקצה ע"י QC עם השמירה'
      : DETECTION_KEYS.has(k) ? 'ממולא אוטומטית — שינוי רק למנהל מערכת / מנהל שחרור' : undefined),
    required: CREATE_REQUIRED_FIELDS,
    missing,
    editingField, setEditingField,
    commitField: (k, v) => { touched.current = true; setValues(prev => ({ ...prev, [k]: v })); setEditingField(null); setMissing(m => { const n = new Set(m); n.delete(k); return n; }); },
    commitPair: (rk, ck, rel, cyc) => {
      touched.current = true;
      if (rk === 'detectedInRelease') { setReleaseManual(true); setRelReason('נבחרה ידנית'); }
      setRefValues(prev => ({ ...prev, [rk]: rel, [ck]: cyc }));
      setEditingField(null);
      setMissing(m => { const n = new Set(m); n.delete(rk); n.delete(ck); return n; });
    },
    outsideCommit,
    teamEnv, fieldPicklists, fieldKinds: editable.kinds, personDirectory, personTeams, releaseOptions,
    currentStatus: 'New', allowedTransitions: null,
    loadScoped: (k, release) => loadReleaseScopedOptions(headers, k, release),
  };

  // ── leave guard (2026-10-09) ────────────────────────────────────────────
  const typedCount = !createdIdPendingAttachments
    ? [title.trim(), description.trim(), comment.trim(), attachedFiles.length > 0, touched.current].filter(Boolean).length : 0;
  const { confirmLeave } = useUnsavedChanges();
  useLeaveGuard({ count: () => (creating ? 0 : typedCount), label: () => 'תקלה חדשה שטרם נוצרה' });
  const leave = async () => { if (await confirmLeave()) onBack(); };

  const submit = async () => {
    // Detected By / on Date: the server writes you / today when they are empty
    const miss = new Set(Array.from(CREATE_REQUIRED_FIELDS).filter(k => !DETECTION_KEYS.has(k) && !valueOf(k).trim()));
    const missText = [
      ...(title.trim() ? [] : ['Title']),
      ...Array.from(miss).map(k => DETAIL_FIELD_LABEL[k] ?? k),
      ...(comment.trim() ? [] : ['Comments']),
    ];
    setMissing(miss);
    if (missText.length) { setError(`חסרים שדות חובה: ${missText.join(', ')}`); return; }
    setCreating(true); setError(null);
    try {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) if (v?.trim() && editable.fields.has(k)) fields[k] = v;
      const refFields: Record<string, RefValue> = {};
      for (const [k, v] of Object.entries(refValues)) if (v?.id) refFields[k] = v;
      const res = await axios.post(`${API}/qc/defects`, {
        form: true, title: title.trim(), description: description.trim(), comment: comment.trim(), fields, refFields,
      }, { headers });
      const newId = res.data?.id;
      if (!newId) { setError('התקלה נוצרה ב-QC אך לא זוהה מזהה בתשובה — בדוק ידנית ב-QC'); return; }
      if (attachedFiles.length > 0) {
        const failures: { file: File; message: string }[] = [];
        for (const file of attachedFiles) {
          const form = new FormData();
          form.append('file', file);
          try { await axios.post(`${API}/qc/defect/${encodeURIComponent(newId)}/attachments`, form, { headers }); }
          catch (err: any) { failures.push({ file, message: err?.response?.data?.message || 'העלאה נכשלה' }); }
        }
        if (failures.length > 0) { setFailedFiles(failures); setCreatedIdPendingAttachments(newId); return; }
      }
      onCreated(newId);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'יצירת התקלה נכשלה');
    } finally {
      setCreating(false);
    }
  };

  const retryAttachments = async () => {
    if (!createdIdPendingAttachments) return;
    setCreating(true);
    const stillFailing: { file: File; message: string }[] = [];
    for (const { file } of failedFiles) {
      const form = new FormData();
      form.append('file', file);
      try { await axios.post(`${API}/qc/defect/${encodeURIComponent(createdIdPendingAttachments)}/attachments`, form, { headers }); }
      catch (err: any) { stillFailing.push({ file, message: err?.response?.data?.message || 'העלאה נכשלה' }); }
    }
    setFailedFiles(stillFailing);
    setCreating(false);
    if (stillFailing.length === 0) onCreated(createdIdPendingAttachments);
  };

  const fieldGrid = (fields: string[], wide?: string[]) => (
    <div className="grid gap-x-3 gap-y-3" style={{ direction: 'ltr', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
      {fields.map(f => <DefectFieldCell key={f} fieldKey={f} wide={!!wide?.includes(f)} ctx={ctx} />)}
    </div>
  );
  const panelCard = (name: string, body: React.ReactNode, key: string) => (
    <div key={key} dir="rtl" className="rounded-xl px-6 py-6" style={{ background: '#fff', height: '100%' }}>
      <div dir="auto" className="mb-3 text-start text-sm font-bold text-foreground">{name}</div>
      {body}
    </div>
  );
  const textBox = 'w-full resize-y rounded-sm bg-card px-3 py-2 text-[13px] text-foreground outline-none';
  const reqMark = <span style={{ color: '#DE350B' }} title="שדה חובה ב-QC">*</span>;

  return (
    <div className="flex flex-col gap-4 px-7 py-5" dir="rtl">
      <div className="flex min-h-[34px] items-center justify-between">
        <BackLink onClick={leave} label="חזרה" />
        <span className="text-lg font-bold text-foreground">🐞 תקלה חדשה ב-QC</span>
      </div>

      {/* Title — as in the update form */}
      <div className="rounded-xl px-6 py-5" style={{ background: '#fff' }}>
        <label className="block text-xs font-bold text-subtle-foreground" style={{ direction: 'ltr', textAlign: 'left' }}>Title {reqMark}</label>
        <input value={title} onChange={e => setTitle(e.target.value)} dir="auto" placeholder="כותרת קצרה וברורה של התקלה"
          className="mt-1.5 w-full rounded-sm px-3 py-2 text-[15px] font-semibold text-foreground outline-none"
          style={{ border: `1px solid ${error && !title.trim() ? '#DE350B' : JIRA.greyN40}` }} />
      </div>

      {relReason && (
        <div className="rounded-md px-4 py-2 text-[13px]" style={{ background: refValues.detectedInRelease ? '#eef4ff' : C.warningBg, color: JIRA.text }}>
          📍 {refValues.detectedInRelease
            ? <>גרסת הגילוי: <b dir="ltr">{refValues.detectedInRelease.label}</b>{refValues.detectedInCycle ? <> · סבב <b dir="ltr">{refValues.detectedInCycle.label}</b></> : null} — {relReason}
              {!refValues.detectedInCycle && <span className="font-semibold" style={{ color: C.warning }}> · בחר סבב בשדה Detected in Cycle</span>}</>
            : <>{relReason}</>}
        </div>
      )}

      {/* the same panels, fields and pickers as the update form */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, direction: 'ltr' }}>
        {shownPanels.map((p, i) => panelCard(p.name, fieldGrid(p.fields, p.wide), `p${i}`))}
        {requiredOutside.length > 0 && panelCard('שדות חובה', fieldGrid(requiredOutside), 'req')}
      </div>

      {moreFields.length > 0 && (
        <div className="rounded-xl px-6 py-4" style={{ background: '#fff' }}>
          <button type="button" onClick={() => setShowMore(v => !v)} className="cursor-pointer border-none bg-transparent p-0 text-sm font-bold text-foreground">
            {showMore ? '▾' : '▸'} שדות נוספים ({moreFields.length}) <span className="text-xs font-normal text-subtle-foreground">— לא נדרשים בפתיחת תקלה</span>
          </button>
          {showMore && <div className="mt-3">{fieldGrid(moreFields)}</div>}
        </div>
      )}

      {/* Description + the first comment, side by side as in the update form */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', direction: 'ltr' }}>
        <div dir="rtl" className="flex flex-col gap-1.5 rounded-xl px-6 py-5" style={{ background: '#fff' }}>
          <label className="text-xs font-bold text-subtle-foreground" style={{ direction: 'ltr', textAlign: 'left' }}>Description</label>
          <textarea dir="auto" rows={6} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="שלבי שחזור, התנהגות שהתקבלה מול הצפויה" className={textBox} style={{ border: `1px solid ${JIRA.greyN40}` }} />
        </div>
        <div dir="rtl" className="flex flex-col gap-1.5 rounded-xl px-6 py-5" style={{ background: '#fff' }}>
          <label className="text-xs font-bold text-subtle-foreground" style={{ direction: 'ltr', textAlign: 'left' }}>Comments {reqMark}</label>
          {signature && <div className="text-[11px] text-subtle-foreground" dir="ltr" style={{ textAlign: 'left' }}>{signature}</div>}
          <textarea dir="auto" rows={6} value={comment} onChange={e => setComment(e.target.value)}
            placeholder="הערה ראשונה — חובה ב-QC (למשל: היכן שוחזר, נתוני בדיקה)" className={textBox}
            style={{ border: `1px solid ${error && !comment.trim() ? '#DE350B' : JIRA.greyN40}` }} />
        </div>
      </div>

      <Card>
        <div className="mb-2 text-sm font-bold text-foreground">📎 קבצים מצורפים <span className="text-xs font-normal text-subtle-foreground">(יועלו ל-QC מיד אחרי יצירת התקלה)</span></div>
        <div className="flex flex-col gap-2">
          {attachedFiles.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-sm bg-muted px-3 py-1.5 text-[13px]">
              <span dir="auto" className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="flex-shrink-0 text-subtle-foreground">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="flex-shrink-0 cursor-pointer border-none bg-transparent text-danger">✕</button>
            </div>
          ))}
          <label className="w-fit cursor-pointer rounded-sm px-3 py-2 text-[13px] font-semibold text-primary hover:bg-muted" style={{ border: `1px dashed ${JIRA.greyN40}` }}>
            + הוסף קובץ
            <input type="file" multiple className="hidden" onChange={e => { const fl = e.target.files; if (fl) setAttachedFiles(prev => [...prev, ...Array.from(fl)]); e.target.value = ''; }} />
          </label>
        </div>
      </Card>

      {error && <div className="rounded-md px-4 py-2.5 text-[13px] font-semibold text-danger" style={{ background: C.bgBlocked }}>{error}</div>}

      {createdIdPendingAttachments ? (
        <Card style={{ borderColor: C.warning }}>
          <div className="mb-2 text-[13px] font-semibold text-warning">התקלה {createdIdPendingAttachments} נוצרה בהצלחה, אך {failedFiles.length} קבצים לא הועלו:</div>
          <ul className="mb-3 list-inside list-disc text-[13px] text-danger">{failedFiles.map((f, i) => <li key={i}>{f.file.name}: {f.message}</li>)}</ul>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => onCreated(createdIdPendingAttachments)}>המשך בלי הקבצים</Button>
            <Button onClick={retryAttachments} disabled={creating}>{creating ? 'מנסה שוב…' : '↺ נסה שוב להעלות'}</Button>
          </div>
        </Card>
      ) : (
        <div className="flex items-center justify-end gap-2.5">
          <span className="text-xs text-subtle-foreground"><span style={{ color: '#DE350B' }}>*</span> שדה חובה ב-QC</span>
          <Button variant="outline" onClick={leave}>ביטול</Button>
          <Button onClick={submit} disabled={creating}>{creating ? 'יוצר ב-QC…' : '✓ צור תקלה ב-QC'}</Button>
        </div>
      )}
    </div>
  );
};
