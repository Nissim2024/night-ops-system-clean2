import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatDateTime } from '../utils/dateFormat';
import { DefectIdBadge } from './shared/defectFieldDisplay';
import { Button, TextField, TextArea } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface DefectPreview { id: string; title: string; status: string; statusFieldIsConfirmed: boolean; comments: string; }
export interface FieldRow { name: string; value: string; }
const emptyRows = (n: number): FieldRow[] => Array.from({ length: n }, () => ({ name: '', value: '' }));

// Test tool for the QC REST write-back integration (spec confirmed
// 2026-08-29/30, per-user auth 2026-09-02) — gated by the 'action:qc_write'
// permission, writes to REAL PRODUCTION QC as the logged-in user's own QC
// identity (qcLogin + empty password, nothing stored). Deliberately narrow:
// appends to the internal "Dev Comments" field only, never overwrites it,
// and every write requires an explicit confirm click after seeing the exact
// before/after text. See backend/src/qc/qc-rest.service.ts for why this
// can't go through the existing read-only Oracle connection.
// Shared add/remove row editor for the defect-lab tools below — deliberately
// free-text field names (not a dropdown), since the real REST field names for
// most custom BG_USER_XX fields aren't confirmed for this instance yet; find
// them via "🔍 הצג את כל שמות השדות" above and paste in here.
export const FieldRowsEditor: React.FC<{ rows: FieldRow[]; onChange: (rows: FieldRow[]) => void }> = ({ rows, onChange }) => (
  <div className="flex flex-col gap-2">
    {rows.map((row, i) => (
      <div key={i} className="flex gap-2 items-center">
        <TextField
          value={row.name}
          onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
          placeholder="שם שדה REST (למשל: user-04)"
          className="w-[220px]"
        />
        <TextField
          value={row.value}
          onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
          placeholder="ערך"
          fullWidth
        />
        <Button variant="outline" onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={rows.length <= 1}>
          ✕
        </Button>
      </div>
    ))}
    <Button variant="secondary" onClick={() => onChange([...rows, { name: '', value: '' }])} className="self-start">
      + הוסף שדה
    </Button>
  </div>
);

// Module status matrix (2026-09-23, admin-screen QC infrastructure prep —
// user request: "prepare in the admin screen everything needed to use QC
// across all its modules"). Purely a read of already-existing SystemParams —
// no new backend endpoint — so the admin can see at a glance which modules
// have their connection/credentials/kill-switch ready, without hunting
// through the flat "פרמטרים" tab's alphabetical list.
type ParamRow = { key: string; value: string };
const paramVal = (params: ParamRow[], key: string) => params.find(p => p.key === key)?.value ?? '';
const isOn = (params: ParamRow[], key: string) => paramVal(params, key) === 'true';

const ModuleStatusMatrix: React.FC<{ token: string }> = ({ token }) => {
  const [params, setParams] = useState<ParamRow[] | null>(null);
  useEffect(() => {
    axios.get(`${API}/system-params`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setParams(r.data))
      .catch(() => setParams([]));
  }, [token]);
  if (!params) return null;

  const connectionReady = !!(paramVal(params, 'QC_REST_BASE_URL') && paramVal(params, 'QC_REST_DOMAIN') && paramVal(params, 'QC_REST_PROJECT'));
  const siteAdminCredsReady = !!(paramVal(params, 'QC_ADMIN_USERNAME') && paramVal(params, 'QC_ADMIN_PASSWORD'));

  const rows: { label: string; status: 'live' | 'ready' | 'off' | 'blocked'; note: string }[] = [
    {
      label: 'תקלות (Defects)',
      status: connectionReady ? 'live' : 'blocked',
      note: connectionReady ? 'פעיל — יצירה/עדכון סטטוס/הערות/קבצים מצורפים' : 'חסר חיבור בסיסי (Base URL/Domain/Project)',
    },
    {
      label: 'דרישות (Requirements)',
      status: !connectionReady ? 'blocked' : isOn(params, 'QC_REST_REQ_PUBLISH_ENABLED') ? 'live' : 'ready',
      note: isOn(params, 'QC_REST_REQ_PUBLISH_ENABLED') ? 'מופעל (QC_REST_REQ_PUBLISH_ENABLED=true)' : 'בנוי, כבוי — הפעל ב-QC_REST_REQ_PUBLISH_ENABLED',
    },
    {
      label: 'ניהול — Release/Cycle (Management)',
      status: !connectionReady ? 'blocked' : isOn(params, 'QC_REST_RELEASE_PUBLISH_ENABLED') ? 'live' : 'ready',
      note: isOn(params, 'QC_REST_RELEASE_PUBLISH_ENABLED') ? 'מופעל (QC_REST_RELEASE_PUBLISH_ENABLED=true)' : 'בנוי, כבוי — הפעל ב-QC_REST_RELEASE_PUBLISH_ENABLED',
    },
    {
      label: 'Test Plan (כתיבת/עדכון תסריטים)',
      status: !connectionReady ? 'blocked' : 'off',
      note: 'אין עדיין מסך תכונה — רק בדיקת שדות זמינה למטה (test/test-folder/design-step)',
    },
    {
      label: 'Test Lab (הרצת תסריטים)',
      status: !connectionReady ? 'blocked' : 'off',
      note: 'אין עדיין מסך תכונה — רק בדיקת שדות זמינה למטה (test-set/test-instance/run)',
    },
    {
      label: 'Site Administration',
      status: !siteAdminCredsReady ? 'blocked' : isOn(params, 'QC_SITE_ADMIN_ENABLED') ? 'ready' : 'off',
      note: !siteAdminCredsReady ? 'חסר QC_ADMIN_USERNAME/PASSWORD' : isOn(params, 'QC_SITE_ADMIN_ENABLED') ? 'מופעל לבדיקה בלבד — הפעל ב-QC_SITE_ADMIN_ENABLED' : 'מוגדר, כבוי — הפעל ב-QC_SITE_ADMIN_ENABLED',
    },
  ];

  const badge = (status: typeof rows[number]['status']) => {
    const map = {
      live: { bg: 'bg-success-bg', text: 'text-success', label: '✅ פעיל' },
      ready: { bg: 'bg-warning-bg', text: 'text-warning', label: '🟡 בנוי, כבוי' },
      off: { bg: 'bg-muted', text: 'text-subtle-foreground', label: '⚪ תשתית בלבד' },
      blocked: { bg: 'bg-danger-bg', text: 'text-danger', label: '⛔ חסרה הגדרה' },
    } as const;
    const s = map[status];
    return <span className={`${s.bg} ${s.text} rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap`}>{s.label}</span>;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
      <div className="text-sm font-bold text-foreground">📊 מצב אינטגרציית QC לפי מודול</div>
      <div className="flex flex-col gap-1.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2 flex-wrap py-1 border-b border-border last:border-b-0">
            <div className="min-w-[220px] text-sm font-medium text-foreground">{r.label}</div>
            {badge(r.status)}
            <div className="text-xs text-subtle-foreground">{r.note}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-subtle-foreground mt-1">
        הגדרות חיבור, קרדנציאלים ומתגי ההפעלה נערכים בטאב "⚙️ פרמטרים". בדיקות שדות/חיבור בפועל למטה.
      </div>
    </div>
  );
};

export const QcWriteTestPanel: React.FC<{ token: string }> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [defectId, setDefectId] = useState('47000');
  const [preview, setPreview] = useState<DefectPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [allFields, setAllFields] = useState<Record<string, string> | null>(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsFilter, setFieldsFilter] = useState('');

  // Stage-0 de-risk (2026-09-15): does this QC instance's REST API even
  // support Release/Release-Cycle entities, before any create-Release code
  // is written. Both calls below are read-only.
  const [entityProbe, setEntityProbe] = useState<{ type: string; result?: any; error?: string } | null>(null);
  const [entityProbeLoading, setEntityProbeLoading] = useState(false);

  // Defect lab (2026-09-16) — generic raw field edit on the loaded defect +
  // create-new-defect, ADMIN-only (enforced server-side, see qc.controller.ts).
  // No allowlist/fixed form on purpose: real field/LOV names for this QC
  // instance aren't confirmed yet (docs/spec-defects-module.md) — this is for
  // finding out, not the polished screen.
  const [editRows, setEditRows] = useState<FieldRow[]>(emptyRows(2));
  const [editConfirming, setEditConfirming] = useState(false);
  const [editSending, setEditSending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<string | null>(null);

  const [createRows, setCreateRows] = useState<FieldRow[]>(emptyRows(3));
  const [createConfirming, setCreateConfirming] = useState(false);
  const [createSending, setCreateSending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ id: string | null; raw: Record<string, string> } | null>(null);

  // Stage-0 final test (2026-09-16) — one-shot POST to settle whether release
  // creation works via REST at all now that permission + entity-readability
  // are confirmed. Pre-filled with an obviously-named test value so it's easy
  // to find and delete manually via QC UI afterward.
  const [releaseRows, setReleaseRows] = useState<FieldRow[]>([{ name: 'name', value: 'DEPLOYCENTER_TEST_DELETE_ME' }, { name: 'parent-id', value: '' }]);
  const [releaseConfirming, setReleaseConfirming] = useState(false);
  const [releaseSending, setReleaseSending] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<{ id: string | null; raw: Record<string, string> } | null>(null);

  const sendCreateRelease = async () => {
    setReleaseSending(true);
    setReleaseError(null);
    try {
      const res = await axios.post(`${API}/qc/rest-test/release`, { fields: rowsToFields(releaseRows) }, { headers });
      setReleaseResult({ id: res.data?.id ?? null, raw: res.data?.raw ?? {} });
      setReleaseConfirming(false);
      // Chain into the cycle form so the ID doesn't need retyping.
      if (res.data?.id) setCycleRows(rows => rows.map(r => r.name === 'parent-id' ? { ...r, value: String(res.data.id) } : r));
    } catch (e: any) {
      setReleaseError(e?.response?.data?.message || e.message || 'שגיאה ביצירת ה-Release ב-QC');
    } finally {
      setReleaseSending(false);
    }
  };

  // Other half of the stage-0 create test — release-cycle. parent-id
  // pre-filled from the release just created above (if any), since a cycle
  // needs to belong to a release.
  const [cycleRows, setCycleRows] = useState<FieldRow[]>([{ name: 'name', value: 'DEPLOYCENTER_TEST_CYCLE_DELETE_ME' }, { name: 'parent-id', value: '' }]);
  const [cycleConfirming, setCycleConfirming] = useState(false);
  const [cycleSending, setCycleSending] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [cycleResult, setCycleResult] = useState<{ id: string | null; raw: Record<string, string> } | null>(null);

  const sendCreateCycle = async () => {
    setCycleSending(true);
    setCycleError(null);
    try {
      const res = await axios.post(`${API}/qc/rest-test/release-cycle`, { fields: rowsToFields(cycleRows) }, { headers });
      setCycleResult({ id: res.data?.id ?? null, raw: res.data?.raw ?? {} });
      setCycleConfirming(false);
    } catch (e: any) {
      setCycleError(e?.response?.data?.message || e.message || 'שגיאה ביצירת ה-Release Cycle ב-QC');
    } finally {
      setCycleSending(false);
    }
  };

  // Full orchestration test (2026-09-18) — the real production-shaped flow
  // (auto-resolve/create year folder → create release → create every cycle
  // under it), all in one call. Still ADMIN-only + explicit confirm, still
  // not wired into any real user-facing trigger — this is exactly the same
  // safety gate as every other lab tool here, just testing more at once so a
  // full round-trip against real QC doesn't require a new deploy per piece.
  const defaultOrchestrationInput = JSON.stringify({
    releaseName: 'DEPLOYCENTER_TEST_ORCH_DELETE_ME',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    year: String(new Date().getFullYear()),
    cycles: [
      { name: 'DEPLOYCENTER_TEST_CYCLE_1', startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) },
    ],
  }, null, 2);
  const [orchInput, setOrchInput] = useState(defaultOrchestrationInput);
  const [orchConfirming, setOrchConfirming] = useState(false);
  const [orchSending, setOrchSending] = useState(false);
  const [orchError, setOrchError] = useState<string | null>(null);
  const [orchResult, setOrchResult] = useState<any>(null);
  const [orchParseError, setOrchParseError] = useState<string | null>(null);

  const sendOrchestration = async () => {
    setOrchSending(true);
    setOrchError(null);
    try {
      const body = JSON.parse(orchInput);
      const res = await axios.post(`${API}/qc/rest-test/release-orchestration`, body, { headers });
      setOrchResult(res.data);
      setOrchConfirming(false);
    } catch (e: any) {
      setOrchError(e?.response?.data?.message || e.message || 'שגיאה בהרצת ה-orchestration מול QC');
    } finally {
      setOrchSending(false);
    }
  };

  const rowsToFields = (rows: FieldRow[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r.name.trim()) out[r.name.trim()] = r.value;
    }
    return out;
  };

  const sendFieldsUpdate = async () => {
    setEditSending(true);
    setEditError(null);
    try {
      await axios.patch(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/fields`, { fields: rowsToFields(editRows) }, { headers });
      setEditResult('✓ השדות עודכנו ב-QC.');
      setEditConfirming(false);
      loadPreview();
    } catch (e: any) {
      setEditError(e?.response?.data?.message || e.message || 'שגיאה בעדכון השדות ב-QC');
    } finally {
      setEditSending(false);
    }
  };

  const sendCreateDefect = async () => {
    setCreateSending(true);
    setCreateError(null);
    try {
      const res = await axios.post(`${API}/qc/rest-test/defect`, { fields: rowsToFields(createRows) }, { headers });
      setCreateResult({ id: res.data?.id ?? null, raw: res.data?.raw ?? {} });
      setCreateConfirming(false);
    } catch (e: any) {
      setCreateError(e?.response?.data?.message || e.message || 'שגיאה ביצירת התקלה ב-QC');
    } finally {
      setCreateSending(false);
    }
  };

  const [customEntityType, setCustomEntityType] = useState('requirement');

  // Picklist values (2026-09-19) — separate from probeEntity('defect') above:
  // entity-fields at most tells you a field IS a value-list (and maybe a
  // list id/name), not what the actual allowed values are. This hits QC's
  // separate Project Lists customization collection instead — UNVERIFIED
  // against this real instance, same "raw" defensive shape as the fields
  // probe, so a wrong tag-name guess still surfaces the real response.
  const [listsProbeLoading, setListsProbeLoading] = useState(false);
  const [listsProbe, setListsProbe] = useState<{ result?: any; error?: string } | null>(null);
  const probeLists = async () => {
    setListsProbeLoading(true);
    setListsProbe(null);
    try {
      const res = await axios.get(`${API}/qc/rest-test/lists`, { headers });
      setListsProbe({ result: res.data });
    } catch (e: any) {
      setListsProbe({ error: e?.response?.data?.message || e.message || 'שגיאה בבדיקת רשימות ערכים מול QC' });
    } finally {
      setListsProbeLoading(false);
    }
  };

  // Picklist cache refresh (2026-09-23, fixes-batch A.6) — the REAL sync used
  // by the create/edit forms' dropdowns, distinct from the raw probe above
  // (probeLists just dumps everything for inspection; this one actually
  // writes the 5 mapped fields' values into QcPicklistCache so the forms can
  // read them without ever calling QC live themselves).
  const [picklistSyncLoading, setPicklistSyncLoading] = useState(false);
  const [picklistSyncResult, setPicklistSyncResult] = useState<{ synced?: number; error?: string } | null>(null);
  const syncPicklists = async () => {
    setPicklistSyncLoading(true);
    setPicklistSyncResult(null);
    try {
      const res = await axios.post(`${API}/qc/sync-picklists`, {}, { headers });
      setPicklistSyncResult({ synced: res.data?.synced });
    } catch (e: any) {
      setPicklistSyncResult({ error: e?.response?.data?.message || e.message || 'שגיאה ברענון רשימות ערכים' });
    } finally {
      setPicklistSyncLoading(false);
    }
  };

  const probeEntity = async (type: string) => {
    setEntityProbeLoading(true);
    setEntityProbe({ type });
    try {
      const url = type === 'releases-list'
        ? `${API}/qc/rest-test/releases`
        : `${API}/qc/rest-test/entity-fields/${type}`;
      const res = await axios.get(url, { headers });
      setEntityProbe({ type, result: res.data });
    } catch (e: any) {
      setEntityProbe({ type, error: e?.response?.data?.message || e.message || 'שגיאה בבדיקה מול QC' });
    } finally {
      setEntityProbeLoading(false);
    }
  };

  // Real screenshots (2026-09-18) show new releases live under a year-named
  // folder (Releases → 2026 → ITv07-2026) — this probe finds that folder's
  // real ID so release creation can resolve `parent-id` instead of guessing.
  // Free-text query box using the `{field['value']}` syntax confirmed from
  // real Jenkins code (e.g. `{name['2026']}`); empty = list everything (up to
  // page-size 100) to explore the structure first.
  const [folderQuery, setFolderQuery] = useState("{name['2026']}");
  const [folderProbeLoading, setFolderProbeLoading] = useState(false);
  const [folderProbe, setFolderProbe] = useState<{ result?: any; error?: string } | null>(null);
  // Site Administration probe (2026-09-23) — architecturally separate from
  // every probe above: not domain/project-scoped, authenticates with the
  // shared QC_ADMIN_USERNAME/PASSWORD (Site Admin privilege), gated
  // ADMIN-only server-side (not the general action:qc_write permission).
  // Read-only; no write flow exists yet for this module.
  const [siteAdminSegment, setSiteAdminSegment] = useState('domains');
  const [siteAdminLoading, setSiteAdminLoading] = useState(false);
  const [siteAdminProbe, setSiteAdminProbe] = useState<{ segment: string; result?: string; error?: string } | null>(null);
  const probeSiteAdmin = async (segment: string) => {
    setSiteAdminLoading(true);
    setSiteAdminProbe({ segment });
    try {
      const res = await axios.get(`${API}/qc/rest-test/site-admin/${encodeURIComponent(segment)}`, { headers });
      setSiteAdminProbe({ segment, result: typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2) });
    } catch (e: any) {
      setSiteAdminProbe({ segment, error: e?.response?.data?.message || e.message || 'שגיאה בבדיקת Site Administration מול QC' });
    } finally {
      setSiteAdminLoading(false);
    }
  };

  const probeReleaseFolders = async () => {
    setFolderProbeLoading(true);
    setFolderProbe(null);
    try {
      const res = await axios.get(`${API}/qc/rest-test/release-folders`, { params: folderQuery.trim() ? { q: folderQuery.trim() } : {}, headers });
      setFolderProbe({ result: res.data });
    } catch (e: any) {
      setFolderProbe({ error: e?.response?.data?.message || e.message || 'שגיאה בבדיקת release-folders מול QC' });
    } finally {
      setFolderProbeLoading(false);
    }
  };

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setResult(null);
    setConfirming(false);
    try {
      const res = await axios.get(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}`, { headers });
      setPreview(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלה מ-QC');
    } finally {
      setLoading(false);
    }
  };

  const sendUpdate = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/append-note`, { note }, { headers });
      setResult(res.data?.newValue ?? '');
      setPreview(prev => prev ? { ...prev, comments: res.data?.newValue ?? prev.comments } : prev);
      setConfirming(false);
      setNote('');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בשליחת העדכון ל-QC');
    } finally {
      setSending(false);
    }
  };

  // Diagnostic: dump every REST field name QC actually returns for this
  // defect — BG_DEV_COMMENTS (the raw Oracle column name) turned out not to
  // be the REST field name; this lets us find the real one by inspecting a
  // defect with known real comment text instead of guessing again (spec
  // confirmed 2026-09-01).
  const loadAllFields = async () => {
    setFieldsLoading(true);
    setError(null);
    setAllFields(null);
    try {
      const res = await axios.get(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/fields`, { headers });
      setAllFields(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת רשימת השדות מ-QC');
    } finally {
      setFieldsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <ModuleStatusMatrix token={token} />

      <div className="bg-danger-bg border border-danger/25 rounded-lg p-4 text-sm text-danger">
        ⚠️ כלי זה כותב ל-QC <strong>אמיתי בייצור</strong>, מזוהה מול QC כמשתמש ה-QC המקושר לחשבון שלך (ללא שמירת סיסמה). הוא רק מוסיף שורה ל"הערות פיתוח" הקיימות — לעולם לא מוחק/דורס. כל שליחה דורשת אישור מפורש.
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <div className="text-xs text-subtle-foreground mb-1">מספר תקלה</div>
          <TextField value={defectId} onChange={e => setDefectId(e.target.value)} className="w-[160px]" />
        </div>
        <Button
          variant="primary"
          onClick={loadPreview}
          disabled={loading || !defectId.trim()}
        >
          {loading ? 'טוען...' : 'טען תקלה מ-QC'}
        </Button>
        <Button
          variant="secondary"
          onClick={loadAllFields}
          disabled={fieldsLoading || !defectId.trim()}
          title="מציג את כל שמות השדות ש-REST מחזיר בפועל עבור התקלה, לאבחון שדות שלא נטענים נכון"
        >
          {fieldsLoading ? 'טוען...' : '🔍 הצג את כל שמות השדות (אבחון)'}
        </Button>
      </div>

      {allFields && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            כל שמות השדות שהוחזרו מ-QC עבור תקלה <DefectIdBadge id={defectId} /> ({Object.keys(allFields).length})
          </div>
          <TextField
            value={fieldsFilter}
            onChange={e => setFieldsFilter(e.target.value)}
            placeholder="סנן לפי שם שדה או ערך (למשל: comment)…"
            fullWidth
          />
          <div className="max-h-[360px] overflow-auto border border-border rounded-md">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted">
                  <th className="py-1.5 px-2 text-right border-b border-border">שם שדה (REST)</th>
                  <th className="py-1.5 px-2 text-right border-b border-border">ערך</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(allFields)
                  .filter(([k, v]) => !fieldsFilter.trim() || k.toLowerCase().includes(fieldsFilter.toLowerCase()) || v.toLowerCase().includes(fieldsFilter.toLowerCase()))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-[5px] px-2 border-b border-border font-semibold text-primary whitespace-nowrap">{k}</td>
                      <td className="py-[5px] px-2 border-b border-border text-foreground whitespace-pre-wrap break-words">{v || '(ריק)'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
          {error}
        </div>
      )}

      {preview && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">תקלה <DefectIdBadge id={preview.id} /> — {preview.title || '(ללא כותרת)'}</div>
            <div className="text-xs text-subtle-foreground mt-0.5">
              סטטוס: {preview.status || '—'}
              {!preview.statusFieldIsConfirmed && (
                <span className="ms-2 text-warning">⚠️ מוצג משדה BG_STATUS הלא-נכון — QC_REST_BUG_STATUS_FIELD (BG_USER_04) עדיין לא הוגדר</span>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs text-subtle-foreground mb-1">הערות פיתוח נוכחיות (ב-QC):</div>
            <div className="bg-muted border border-border rounded-md p-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">
              {preview.comments || '(ריק)'}
            </div>
          </div>

          <div>
            <div className="text-xs text-subtle-foreground mb-1">טקסט להוספה:</div>
            <TextArea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="הטקסט הזה יתווסף בסוף ההערות הקיימות, עם חותמת DeployCenter + זמן + שם המשתמש..."
              fullWidth
              className="resize-y"
            />
          </div>

          {!confirming ? (
            <Button
              variant="secondary"
              onClick={() => setConfirming(true)}
              disabled={!note.trim()}
              className="self-start"
            >
              המשך לתצוגה מקדימה
            </Button>
          ) : (
            <div className="bg-warning-bg border border-warning/25 rounded-md p-3 flex flex-col gap-2">
              <div className="text-sm font-semibold text-foreground">הערך שיישלח בפועל ל-QC (הערות פיתוח, אחרי הוספה):</div>
              <div className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">
                {preview.comments ? `${preview.comments}\n---\n[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}` : `[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}`}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                >
                  ביטול
                </Button>
                <Button
                  variant="danger"
                  onClick={sendUpdate}
                  disabled={sending}
                >
                  {sending ? 'שולח ל-QC...' : '🔴 שלח עדכון ל-QC (ייצור)'}
                </Button>
              </div>
            </div>
          )}

          {result !== null && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success">
              ✓ העדכון נשלח בהצלחה ל-QC.
            </div>
          )}

          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <div className="text-sm font-bold text-foreground">🛠 עריכת שדות גולמית (ADMIN בלבד, ללא allowlist)</div>
            <div className="text-xs text-subtle-foreground">
              כלי מעבדה — כל שדה REST שתזין נכתב כמו-שהוא, בלי בדיקת סוג/workflow. לגילוי שמות שדות אמיתיים השתמש ב-"🔍 הצג את כל שמות השדות" למעלה.
            </div>
            <FieldRowsEditor rows={editRows} onChange={setEditRows} />
            {editError && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{editError}</div>}
            {editResult && <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success">{editResult}</div>}
            {!editConfirming ? (
              <Button variant="secondary" onClick={() => setEditConfirming(true)} disabled={Object.keys(rowsToFields(editRows)).length === 0} className="self-start">
                המשך לתצוגה מקדימה
              </Button>
            ) : (
              <div className="bg-warning-bg border border-warning/25 rounded-md p-3 flex flex-col gap-2">
                <div className="text-sm font-semibold text-foreground">השדות שיישלחו ל-QC (PUT, תקלה {preview.id}):</div>
                <pre className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(rowsToFields(editRows), null, 2)}</pre>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditConfirming(false)} disabled={editSending}>ביטול</Button>
                  <Button variant="danger" onClick={sendFieldsUpdate} disabled={editSending}>
                    {editSending ? 'שולח ל-QC...' : '🔴 עדכן שדות ב-QC (ייצור)'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 mt-2">
        <div className="text-sm font-bold text-foreground">🆕 צור תקלה חדשה (ADMIN בלבד — יוצר רשומה אמיתית וקבועה ב-QC)</div>
        <div className="text-xs text-subtle-foreground">
          כלי מעבדה לבדיקת קצה-לקצה — אין allowlist, אין ולידציה. השתמש בשמות שדות REST אמיתיים (גלה דרך "🔍 הצג את כל שמות השדות" על תקלה קיימת דומה).
        </div>
        <FieldRowsEditor rows={createRows} onChange={setCreateRows} />
        {createError && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{createError}</div>}
        {createResult && (
          <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success flex flex-col gap-1">
            <div>✓ נוצרה תקלה{createResult.id ? <> — <DefectIdBadge id={createResult.id} /></> : ' (לא זוהה ID בתשובה, ראה raw)'}</div>
            {Object.keys(createResult.raw).length > 0 && (
              <pre className="bg-card rounded-sm p-2 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(createResult.raw, null, 2)}</pre>
            )}
          </div>
        )}
        {!createConfirming ? (
          <Button variant="secondary" onClick={() => setCreateConfirming(true)} disabled={Object.keys(rowsToFields(createRows)).length === 0} className="self-start">
            המשך לתצוגה מקדימה
          </Button>
        ) : (
          <div className="bg-danger-bg border border-danger/25 rounded-md p-3 flex flex-col gap-2">
            <div className="text-sm font-semibold text-danger">⚠️ פעולה זו יוצרת רשומה אמיתית וקבועה ב-QC production. השדות שיישלחו:</div>
            <pre className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(rowsToFields(createRows), null, 2)}</pre>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateConfirming(false)} disabled={createSending}>ביטול</Button>
              <Button variant="danger" onClick={sendCreateDefect} disabled={createSending}>
                {createSending ? 'יוצר ב-QC...' : '🔴 צור תקלה ב-QC (ייצור)'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 mt-2">
        <div className="text-sm font-bold text-foreground">
          🧪 שלב 0 — האם QC בכלל תומך ביצירת Release / Release Cycle דרך REST?
        </div>
        <div className="text-xs text-subtle-foreground">
          כלי אבחון בלבד — קריאות GET בלבד, לא כותב כלום ל-QC.
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => probeEntity('release')} disabled={entityProbeLoading}>
            בדוק שדות ישות "release"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('release-cycle')} disabled={entityProbeLoading}>
            בדוק שדות ישות "release-cycle"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('defect')} disabled={entityProbeLoading}>
            בדוק שדות ישות "defect"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('releases-list')} disabled={entityProbeLoading}>
            קרא רשימת releases אמיתית
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('requirement')} disabled={entityProbeLoading}>
            בדוק שדות ישות "requirement"
          </Button>
        </div>
        {/* Test Plan / Test Lab presets (2026-09-23, admin-screen QC
            infrastructure prep) — no feature screens exist for either module
            yet; these just make the entity types discoverable without the
            admin needing to already know QC's exact REST segment names.
            Uses the exact same generic probeEntity() as every button above —
            zero new backend code needed for this to work. */}
        <div className="text-xs font-bold text-subtle-foreground mt-1">Test Plan (תסריטי בדיקה)</div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => probeEntity('test')} disabled={entityProbeLoading}>
            בדוק שדות ישות "test"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('test-folder')} disabled={entityProbeLoading}>
            בדוק שדות ישות "test-folder"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('design-step')} disabled={entityProbeLoading}>
            בדוק שדות ישות "design-step"
          </Button>
        </div>
        <div className="text-xs font-bold text-subtle-foreground mt-1">Test Lab (הרצת תסריטים)</div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => probeEntity('test-set')} disabled={entityProbeLoading}>
            בדוק שדות ישות "test-set"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('test-set-folder')} disabled={entityProbeLoading}>
            בדוק שדות ישות "test-set-folder"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('test-instance')} disabled={entityProbeLoading}>
            בדוק שדות ישות "test-instance"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('run')} disabled={entityProbeLoading}>
            בדוק שדות ישות "run"
          </Button>
        </div>
        {/* Generic prober (2026-09-18) — next modules per spec-qc-full-
            integration.md need entity types we haven't guessed yet
            (requirement, test-folder, tests, test-set?, test-instance, run).
            Free-text so testing them doesn't need a new deploy each time. */}
        <div className="flex gap-2 items-center">
          <TextField value={customEntityType} onChange={e => setCustomEntityType(e.target.value)} placeholder="שם entity type (למשל: requirement)" className="w-[220px]" dir="ltr" />
          <Button variant="secondary" onClick={() => customEntityType.trim() && probeEntity(customEntityType.trim())} disabled={entityProbeLoading || !customEntityType.trim()}>
            בדוק שדות ישות (כללי)
          </Button>
        </div>
        {entityProbeLoading && <div className="text-sm text-subtle-foreground">בודק מול QC...</div>}
        {entityProbe?.error && (
          <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
            [{entityProbe.type}] {entityProbe.error}
          </div>
        )}
        {entityProbe?.result !== undefined && (
          <pre className="bg-muted border border-border rounded-md p-3 text-xs text-foreground whitespace-pre-wrap max-h-[300px] overflow-auto" dir="ltr">
            {JSON.stringify(entityProbe.result, null, 2)}
          </pre>
        )}

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">📋 רשימות ערכים (Picklists) — מה הערכים האמיתיים של כל שדה עם רשימה?</div>
          <div className="text-xs text-subtle-foreground">
            שדות עם רשימה (Severity/Priority/Status/וכו') לרוב מפנים למזהה רשימה בלבד ב-"בדוק שדות ישות" למעלה —
            זה קורא לאוסף הרשימות הנפרד של QC ומחזיר את הערכים עצמם. חדש, לא מאומת עדיין מול המופע האמיתי.
          </div>
          <div>
            <Button variant="secondary" onClick={probeLists} disabled={listsProbeLoading}>
              {listsProbeLoading ? 'בודק...' : 'הבא את כל רשימות הערכים מ-QC'}
            </Button>
          </div>
          {listsProbe?.error && (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
              {listsProbe.error}
            </div>
          )}
          {listsProbe?.result !== undefined && (
            <pre className="bg-muted border border-border rounded-md p-3 text-xs text-foreground whitespace-pre-wrap max-h-[300px] overflow-auto" dir="ltr">
              {JSON.stringify(listsProbe.result, null, 2)}
            </pre>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🔄 רענון מטמון רשימות ערכים לטופס התקלה</div>
          <div className="text-xs text-subtle-foreground">
            מרענן את הערכים האמיתיים של Responsibility / Bug Type / Test Phase / Environment / CR-HBR Reference מ-QC ושומר אותם אצלנו —
            זה מה שהטפסים בפועל קוראים (בלי לפנות ל-QC בכל פתיחת שדה). הפעל שוב אחרי כל שינוי ברשימות האלה ב-QC עצמו.
          </div>
          <div>
            <Button variant="secondary" onClick={syncPicklists} disabled={picklistSyncLoading}>
              {picklistSyncLoading ? 'מרענן...' : 'רענן עכשיו'}
            </Button>
          </div>
          {picklistSyncResult?.error && (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
              {picklistSyncResult.error}
            </div>
          )}
          {picklistSyncResult?.synced !== undefined && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success">
              רוענו {picklistSyncResult.synced} רשימות בהצלחה
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🏛️ Site Administration — דומיינים/פרויקטים/משתמשים ברמת האתר</div>
          <div className="text-xs text-subtle-foreground">
            נפרד מכל שאר הבדיקות למעלה: לא בטווח דומיין/פרויקט, ומתחבר עם משתמש/סיסמת QC Admin (בפרמטרי המערכת) ולא עם ה-qcLogin שלך.
            דורש שגם QC_SITE_ADMIN_ENABLED וגם QC_ADMIN_USERNAME/PASSWORD מוגדרים. קריאות GET בלבד.
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => probeSiteAdmin('domains')} disabled={siteAdminLoading}>
              בדוק "domains"
            </Button>
            <Button variant="secondary" onClick={() => probeSiteAdmin('projects')} disabled={siteAdminLoading}>
              בדוק "projects"
            </Button>
            <Button variant="secondary" onClick={() => probeSiteAdmin('site-users')} disabled={siteAdminLoading}>
              בדוק "site-users"
            </Button>
          </div>
          <div className="flex gap-2 items-center">
            <TextField value={siteAdminSegment} onChange={e => setSiteAdminSegment(e.target.value)} placeholder="נתיב site-admin (למשל: domains)" className="w-[220px]" dir="ltr" />
            <Button variant="secondary" onClick={() => siteAdminSegment.trim() && probeSiteAdmin(siteAdminSegment.trim())} disabled={siteAdminLoading || !siteAdminSegment.trim()}>
              בדוק (כללי)
            </Button>
          </div>
          {siteAdminLoading && <div className="text-sm text-subtle-foreground">בודק מול QC...</div>}
          {siteAdminProbe?.error && (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
              [{siteAdminProbe.segment}] {siteAdminProbe.error}
            </div>
          )}
          {siteAdminProbe?.result !== undefined && (
            <pre className="bg-muted border border-border rounded-md p-3 text-xs text-foreground whitespace-pre-wrap max-h-[300px] overflow-auto" dir="ltr">
              {siteAdminProbe.result}
            </pre>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🔍 בדיקת release-folders — לאיזו תיקייה נכנס Release חדש?</div>
          <div className="text-xs text-subtle-foreground">
            מהצילומים רואים שכל release אמיתי חי תחת תיקיית-שנה (למשל "2026"). זה מוצא את ה-ID האמיתי שלה כדי שיצירת Release תדע לאן להיכנס — קריאה בלבד.
          </div>
          <div className="flex gap-2 items-center">
            <TextField value={folderQuery} onChange={e => setFolderQuery(e.target.value)} placeholder="{name['2026']}" className="w-[260px]" dir="ltr" />
            <Button variant="secondary" onClick={probeReleaseFolders} disabled={folderProbeLoading}>
              {folderProbeLoading ? 'בודק...' : 'חפש release-folders'}
            </Button>
          </div>
          {folderProbe?.error && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{folderProbe.error}</div>}
          {folderProbe?.result !== undefined && (
            <pre className="bg-muted border border-border rounded-md p-3 text-xs text-foreground whitespace-pre-wrap max-h-[300px] overflow-auto" dir="ltr">
              {JSON.stringify(folderProbe.result, null, 2)}
            </pre>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🆕 בדיקת יצירה חד-פעמית — Release אמיתי (ADMIN בלבד)</div>
          <div className="text-xs text-warning">
            ⚠️ יוצר Release אמיתי וקבוע ב-QC production. השתמש בשם ברור-לזיהוי כדי שתוכל למחוק ידנית ב-QC UI אחרי הבדיקה.
            אם ליצירה אמיתית נדרש `parent-id` (Release Folder) — מלא אותו לפי אחד הערכים שראית ברשימת ה-releases האמיתית שקראת קודם.
          </div>
          <FieldRowsEditor rows={releaseRows} onChange={setReleaseRows} />
          {releaseError && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{releaseError}</div>}
          {releaseResult && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success flex flex-col gap-1">
              <div>✓ נוצר Release{releaseResult.id ? ` — ID: ${releaseResult.id}` : ' (לא זוהה ID בתשובה, ראה raw)'} — זכור למחוק ידנית ב-QC UI!</div>
              {Object.keys(releaseResult.raw).length > 0 && (
                <pre className="bg-card rounded-sm p-2 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(releaseResult.raw, null, 2)}</pre>
              )}
            </div>
          )}
          {!releaseConfirming ? (
            <Button variant="secondary" onClick={() => setReleaseConfirming(true)} disabled={Object.keys(rowsToFields(releaseRows)).length === 0} className="self-start">
              המשך לתצוגה מקדימה
            </Button>
          ) : (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 flex flex-col gap-2">
              <div className="text-sm font-semibold text-danger">⚠️ פעולה זו יוצרת Release אמיתי וקבוע ב-QC production. השדות שיישלחו:</div>
              <pre className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(rowsToFields(releaseRows), null, 2)}</pre>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setReleaseConfirming(false)} disabled={releaseSending}>ביטול</Button>
                <Button variant="danger" onClick={sendCreateRelease} disabled={releaseSending}>
                  {releaseSending ? 'יוצר ב-QC...' : '🔴 צור Release ב-QC (ייצור)'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🆕 בדיקת יצירה חד-פעמית — Release Cycle תחת הגרסה (ADMIN בלבד)</div>
          <div className="text-xs text-warning">
            ⚠️ יוצר Release Cycle אמיתי וקבוע ב-QC production, תחת ה-`parent-id` (Release ID) שתמלא —
            אם יצרת Release למעלה, ה-ID שלו כבר מולא כאן אוטומטית. אם לא, קח ID אמיתי מרשימת ה-releases.
          </div>
          <FieldRowsEditor rows={cycleRows} onChange={setCycleRows} />
          {cycleError && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{cycleError}</div>}
          {cycleResult && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success flex flex-col gap-1">
              <div>✓ נוצר Release Cycle{cycleResult.id ? ` — ID: ${cycleResult.id}` : ' (לא זוהה ID בתשובה, ראה raw)'} — זכור למחוק ידנית ב-QC UI!</div>
              {Object.keys(cycleResult.raw).length > 0 && (
                <pre className="bg-card rounded-sm p-2 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(cycleResult.raw, null, 2)}</pre>
              )}
            </div>
          )}
          {!cycleConfirming ? (
            <Button variant="secondary" onClick={() => setCycleConfirming(true)} disabled={Object.keys(rowsToFields(cycleRows)).length === 0} className="self-start">
              המשך לתצוגה מקדימה
            </Button>
          ) : (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 flex flex-col gap-2">
              <div className="text-sm font-semibold text-danger">⚠️ פעולה זו יוצרת Release Cycle אמיתי וקבוע ב-QC production. השדות שיישלחו:</div>
              <pre className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(rowsToFields(cycleRows), null, 2)}</pre>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCycleConfirming(false)} disabled={cycleSending}>ביטול</Button>
                <Button variant="danger" onClick={sendCreateCycle} disabled={cycleSending}>
                  {cycleSending ? 'יוצר ב-QC...' : '🔴 צור Release Cycle ב-QC (ייצור)'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-foreground">🚀 בדיקת Orchestration מלאה — Release+Cycles אוטומטי (ADMIN בלבד)</div>
          <div className="text-xs text-warning">
            ⚠️ זו הפעולה האמיתית המתוכננת ל-production (§3.5 שלב 2): מוצא/יוצר תיקיית-שנה אוטומטית, יוצר Release תחתיה, ואז את כל הסבבים תחת ה-Release. עדיין לא מחוברת לשום כפתור אמיתי במסכי המשתמש — רק כלי בדיקה. יוצרת רשומות אמיתיות וקבועות ב-QC — למחוק ידנית אחרי הבדיקה.
          </div>
          <TextArea value={orchInput} onChange={e => { setOrchInput(e.target.value); setOrchParseError(null); }} rows={12} fullWidth className="font-mono text-xs" style={{ direction: 'ltr', textAlign: 'left' }} />
          {orchParseError && <div className="text-xs text-danger">{orchParseError}</div>}
          {orchError && <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">{orchError}</div>}
          {orchResult && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success flex flex-col gap-1">
              <div>✓ הסתיים — בדוק ידנית ב-QC UI ומחק את כל מה שנוצר.</div>
              <pre className="bg-card rounded-sm p-2 text-xs text-foreground whitespace-pre-wrap" dir="ltr">{JSON.stringify(orchResult, null, 2)}</pre>
            </div>
          )}
          {!orchConfirming ? (
            <Button
              variant="secondary"
              onClick={() => {
                try { JSON.parse(orchInput); setOrchConfirming(true); }
                catch { setOrchParseError('JSON לא תקין'); }
              }}
              className="self-start"
            >
              המשך לתצוגה מקדימה
            </Button>
          ) : (
            <div className="bg-danger-bg border border-danger/25 rounded-md p-3 flex flex-col gap-2">
              <div className="text-sm font-semibold text-danger">⚠️ פעולה זו יוצרת Release + Cycle(s) אמיתיים וקבועים ב-QC production, כולל תיקיית-שנה אם היא לא קיימת.</div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOrchConfirming(false)} disabled={orchSending}>ביטול</Button>
                <Button variant="danger" onClick={sendOrchestration} disabled={orchSending}>
                  {orchSending ? 'רץ מול QC...' : '🔴 הרץ Orchestration מלא ב-QC (ייצור)'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
