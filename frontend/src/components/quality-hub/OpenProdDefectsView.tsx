import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, JIRA } from '../../theme';
import { Card, Badge, BackLink, Modal, Button, TextField } from '../ui';
import { FieldRow, FieldRowsEditor } from '../QcWriteTestPanel';
import { TABLE_COLUMN_FIELDS, TABLE_FIELD_LABEL, DETAIL_FIELDS, DETAIL_FIELD_LABEL } from './openProdDefectsFields';
import {
  hasHebrew, NameBadge, PersonAvatar, renderNotesField, DetailGroupsDialog, DetailGroup,
  FieldChangeHistorySection, AttachmentsSection, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow,
  IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, SEVERITY_COLOR, SelectColumnsDialog, SavedFilterState,
} from '../shared/defectFieldDisplay';
import { formatDate, formatDateTime } from '../../utils/dateFormat';
import { cn } from '../../lib/utils';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// KPI 11 — "מצב תקלות ייצור פתוחות לאורך חודשים". Cross-release, all-history
// report (no version scoping) — matches the reference Power BI page, which
// filters by Responsibility/Status/Year/FixType/Type only, never by release.

interface OpenProdDefectMonthRow {
  monthDate: string;
  monthLabel: string;
  defectId: string;
  statusAtMonth: string;
  currentStatus: string;
  releaseId: string | null;
  severity: string | null;
  priority: string | null;
  responsibility: string | null;
  testPhase: string | null;
  detectedBy: string | null;
  detectedDate: string | null;
  reopenYn: string | null;
  area: string | null;
  bugType: string | null;
  fixType: string | null;
}

interface DefectStatusHistoryRow { status: string; changeTime: string; }

interface OpenProdDefectsConfig { tableColumns: string[]; detailFields: string[]; }

// Full ~50-field record — matches backend's TargetDefectDto (see
// qc.service.ts's DEFECT_BY_ID_SQL / mapRowToTargetDefect). Only the fields
// this screen actually renders are typed strictly; the rest come through as
// whatever DETAIL_FIELDS keys resolve to on the object.
interface DefectFullDetail { id: string; [key: string]: any; }

interface Props { token: string; }

// Person-owner fields render as an avatar (resolved name if a login happens
// to match a synced User.qcLogin, else the raw login degrades to a single
// letter + itself); team/queue fields get the flat NameBadge instead.
// `assignedTo`/BG_RESPONSIBLE was previously treated as a team/queue field
// here (user-confirmed 2026-09-07) — reversed 2026-09-18 after the user saw
// real resolved values ("Yael Morgenstern Teff") in the live detail screen
// and confirmed it does hold a person's name, matching `responsibility`
// which stays the one genuine team field.
const PERSON_BADGE_FIELDS = new Set(['assignedTo', 'qaTester', 'detectedBy', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo']);
const TEAM_BADGE_FIELDS = new Set(['responsibility']);

// title/description/notes always render in their own fixed spots (the big
// title line and the side-by-side text boxes) — never offered in the
// category picker.
const DETAIL_GROUPS_FIXED_FIELDS = new Set(['title', 'description', 'notes']);
const DETAIL_GROUPS_STORAGE_KEY = 'deploycenter_openprod_defect_detail_groups';
const OPENPROD_TABLE_COLUMNS_STORAGE_KEY = 'deploycenter_openprod_defect_table_columns_v1';
// Saved views (docs/spec-defects-module.md §11) — named presets of
// columns+sort+filters, per-browser like every other picker here.
const OPENPROD_SAVED_VIEWS_STORAGE_KEY = 'deploycenter_openprod_defect_saved_views_v1';
interface SavedView {
  name: string;
  columns: string[];
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  filterState: SavedFilterState;
}

// Same 6-category layout as VersionOverview's TARGET-defect detail screen —
// DETAIL_FIELDS' key set overlaps almost entirely with TargetDefect's, so
// the same grouping logic (identification → detection → ownership → fix →
// target/release → business impact) applies here too (spec 2026-08-30).
const DEFAULT_OPEN_PROD_DETAIL_GROUPS: DetailGroup[] = [
  { title: 'זיהוי', fields: ['id', 'status', 'severity', 'priority', 'secondaryPriority', 'defectType', 'category', 'itemType'] },
  { title: 'גילוי', fields: ['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'reproducible', 'environment', 'environmentComponent', 'system', 'platform', 'subModule', 'mainModule', 'systemComponent'] },
  { title: 'אחריות', fields: ['assignedTo', 'qaTester', 'responsibility', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo', 'vendorStatus'] },
  { title: 'טיפול ותיקון', fields: ['fixType', 'estimatedFixTime', 'actualFixTime', 'estimateFixTime', 'fixedUntil', 'fixedInProd', 'closedBy', 'reopenYn', 'supportStatus', 'supportReferenceNumber', 'responseDate'] },
  { title: 'יעד וגרסה', fields: ['targetRelease', 'targetCycle', 'targetType', 'targetReleaseReason', 'targetScopeApproved', 'crStatus', 'crReferenceNumber', 'crHbrNumberReference', 'dropNumber', 'releaseDefect'] },
  { title: 'השפעה עסקית', fields: ['impact', 'influence', 'businessProcess', 'mainBusinessProcess', 'deploymentCategory', 'deploymentReason', 'productionReason', 'toBeTestedOnProd', 'deploymentDateProd', 'willBeTestAtGoLive', 'forRegressionTest', 'foundByAutomation', 'modified'] },
];

// Real calendar date/timestamp fields among DETAIL_FIELDS — everything else
// with "time" in its label (estimatedFixTime/actualFixTime/estimateFixTime)
// is actually a duration in HOURS (see qc.service.ts's BG_ESTIMATED_FIX_TIME
// mock values: '4', '8', '16'), not a date, and must never be run through
// formatDate. Standardizing on the app-wide formatDate/formatDateTime
// (utils/dateFormat) instead of raw String(value) — found 2026-09-03: this
// screen was one of the places the date-format standard wasn't applied yet.
const DATE_ONLY_FIELDS = new Set(['detectedOnDate', 'deploymentDateProd', 'responseDate', 'fixedUntil']);
const DATETIME_FIELDS = new Set(['modified']); // BG_VTS — QC's own last-modified timestamp

// QC descriptions come back as HTML fragments (<p>/<br>, entities like
// &nbsp;/&lt;) — decode to plain readable text with real line breaks instead
// of rendering the raw escaped markup (UX spec 2026-09-06).
function decodeDefectText(raw: string): string {
  let t = raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = t;
    t = el.value;
  } else {
    t = t.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
         .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&');
  }
  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

// id/status/severity/priority — shared Jira treatment with every other
// defect table/detail screen in the app (feedback 2026-09-10).
function renderFieldValue(key: string, value: unknown) {
  const s = value === null || value === undefined ? '' : String(value);
  if (!s) return '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s} full />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'id') return <IssueKeyLink id={s} />;
  if (key === 'status') return <StatusBadge status={s} />;
  if (key === 'severity') return <SeverityBadge severity={s} />;
  if (key === 'priority' || key === 'secondaryPriority') return <PriorityCell value={s} />;
  if (DATE_ONLY_FIELDS.has(key)) return formatDate(s);
  if (DATETIME_FIELDS.has(key)) return formatDateTime(s);
  return s;
}

const DETAIL_TOP_BTN_CLASS = 'px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer text-[13px]';
const DETAIL_SECTION_HEADING_CLASS = 'text-xs font-bold mb-2 tracking-wide';

// Common BG_STATUS values in this QC instance — a `datalist` (not a hard
// `<select>`) so a real status the list doesn't yet know still typeable.
const QC_STATUS_OPTIONS = ['New', 'Open', 'At Work', 'Fixed_Dev', 'Fixed_Test', 'Pending', 'Reopen', 'Rejected', 'Closed', 'Canceled'];

// Direct write-back to QC — status + a dev-comment append — shown expanded by
// default inside the defect detail screen (spec 2026-09-07). Every call goes
// through /qc/rest-test/* which authenticates as the acting user's own QC
// identity; a 403 (no action:qc_write permission or no linked qcLogin) is
// rendered as a quiet inline note instead of an input form.
// The Tier 2 ("safe") field set confirmed with the user 2026-09-18
// (docs/spec-defects-module.md §6) — business keys match exactly what
// qc-rest.service.ts::updateDefectTier2Fields expects; the real REST field
// name behind each is configured separately (SystemParam, empty until
// discovered) and stays entirely server-side.
const TIER2_FIELDS: { key: string; label: string }[] = [
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'subModule', label: 'Sub Module' },
  { key: 'mainModule', label: 'Main Module' },
];

// Real closed value-lists confirmed from live Oracle reads (SEVERITY_COLOR /
// PriorityCell already used app-wide for these exact same values — see
// shared/defectFieldDisplay.tsx) — 2026-09-18 fix: these two fields were
// plain free-text inputs below even though QC itself only accepts one of a
// fixed set. Assigned To / Sub Module / Main Module have no confirmed real
// value list yet (project tree / dynamic user list) — stay free text until
// Tuesday's QC metadata probe.
const TIER2_FIELD_OPTIONS: Record<string, string[]> = {
  severity: ['Show Stopper', 'Severe', 'Medium', 'Low'],
  priority: ['High', 'Medium', 'Low'],
};

// Fields the sidebar's inline double-click editor (2026-09-19 spec, see
// project-inline-defect-field-editor memory) may open — deliberately the
// exact same set QcWriteBackPanel already writes (status + the 6 Tier2
// fields), never the read-only display-only fields, since those have no
// confirmed REST field name yet (blocked until Tuesday's QC probe).
const INLINE_EDITABLE_FIELDS = new Set(['status', ...TIER2_FIELDS.map(f => f.key)]);

// `blocked`/`allowedTransitions` are now owned by the parent DefectDetailScreen
// (2026-09-19) — the new inline sidebar editor needs the exact same two
// pieces of state to gate its own "✏️ ערוך" button and status dropdown, so
// they're fetched once and passed down instead of each surface probing QC
// independently.
const QcWriteBackPanel: React.FC<{
  defectId: string; token: string; currentStatus: string; currentValues: Record<string, string>;
  blocked: string | null; allowedTransitions: string[] | null;
}> = ({ defectId, token, currentStatus, currentValues, blocked, allowedTransitions }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tier2Values, setTier2Values] = useState<Record<string, string>>(currentValues);
  const [savingTier2, setSavingTier2] = useState(false);
  const [tier2Msg, setTier2Msg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { setTier2Values(currentValues); }, [currentValues]);

  useEffect(() => { setStatus(currentStatus); }, [currentStatus]);

  const saveStatus = async () => {
    if (!status.trim() || status.trim() === currentStatus.trim()) return;
    setSavingStatus(true); setMsg(null);
    try {
      const r = await axios.patch(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/status`, { status: status.trim() }, { headers });
      setMsg({ kind: 'ok', text: `הסטטוס עודכן ב-QC: "${r.data?.oldStatus ?? currentStatus}" ← "${r.data?.newStatus ?? status}"` });
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.response?.data?.message || 'עדכון הסטטוס נכשל' });
    } finally { setSavingStatus(false); }
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true); setMsg(null);
    try {
      await axios.post(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/append-note`, { note: note.trim() }, { headers });
      setMsg({ kind: 'ok', text: 'ההערה נוספה ל-QC' });
      setNote('');
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.response?.data?.message || 'הוספת ההערה נכשלה' });
    } finally { setSavingNote(false); }
  };

  // Only sends fields that actually changed from what QC last reported —
  // avoids re-writing (and re-triggering any workflow side-effect on) a
  // field the user didn't touch. A per-field REST-name mapping that's still
  // unconfigured surfaces as a clear inline error from the backend (never
  // silently skipped), same as the status/note actions above.
  const saveTier2 = async () => {
    const changed: Record<string, string> = {};
    for (const f of TIER2_FIELDS) {
      const next = (tier2Values[f.key] ?? '').trim();
      const prev = (currentValues[f.key] ?? '').trim();
      if (next !== prev) changed[f.key] = next;
    }
    if (Object.keys(changed).length === 0) return;
    setSavingTier2(true); setTier2Msg(null);
    try {
      await axios.patch(`${API}/qc/defects/${encodeURIComponent(defectId)}/fields`, { fields: changed }, { headers });
      setTier2Msg({ kind: 'ok', text: `עודכן ב-QC: ${Object.keys(changed).join(', ')}` });
    } catch (err: any) {
      setTier2Msg({ kind: 'err', text: err?.response?.data?.message || 'עדכון השדות נכשל' });
    } finally { setSavingTier2(false); }
  };
  const tier2Dirty = TIER2_FIELDS.some(f => (tier2Values[f.key] ?? '').trim() !== (currentValues[f.key] ?? '').trim());

  const inputClass = 'w-full box-border px-2.5 py-2 rounded-sm border border-border text-sm bg-card text-foreground';
  const btnClass = 'px-4 py-[7px] bg-primary text-white border-none rounded-sm cursor-pointer text-[13px] font-semibold';

  return (
    // Explicit dir="rtl" — this whole panel is Hebrew UI text with no other
    // per-element direction marking, so it must not depend on whatever
    // ambient direction its container happens to use (the parent screen now
    // forces dir="ltr" on itself for its own macro layout — see
    // DefectDetailScreen).
    <section dir="rtl" className="mt-6 border border-border rounded-md bg-muted px-[18px] py-4">
      <div className={`${DETAIL_SECTION_HEADING_CLASS} text-subtle-foreground`}>
        ✏️ עדכון ישיר ל-QC <span className="font-normal opacity-70">(גיבוי — ניתן גם לערוך ישירות בסרגל הצד)</span>
      </div>
      {blocked ? (
        <div className="text-[13px] text-subtle-foreground leading-relaxed">{blocked}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-[13px] text-subtle-foreground block mb-1.5">
              סטטוס תקלה{allowedTransitions && <span className="text-success"> · לפי workflow אמיתי של הצוות שלך</span>}
            </label>
            <div className="flex gap-2 items-center flex-wrap">
              {allowedTransitions ? (
                allowedTransitions.length > 0 ? (
                  <select value={status} onChange={e => setStatus(e.target.value)} className={`${inputClass} flex-1 min-w-[160px]`} dir="ltr">
                    <option value={currentStatus}>{currentStatus} (נוכחי)</option>
                    {allowedTransitions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <div className="text-[13px] text-subtle-foreground flex-1">אין מעבר סטטוס אפשרי מ-"{currentStatus}" לצוות שלך</div>
                )
              ) : (
                <>
                  <input list="qc-status-options" value={status} onChange={e => setStatus(e.target.value)} className={`${inputClass} flex-1 min-w-[160px]`} dir="ltr" />
                  <datalist id="qc-status-options">
                    {QC_STATUS_OPTIONS.map(s => <option key={s} value={s} />)}
                  </datalist>
                </>
              )}
              <button onClick={saveStatus} disabled={savingStatus || !status.trim() || status.trim() === currentStatus.trim()} className={`${btnClass} ${(savingStatus || status.trim() === currentStatus.trim()) ? 'opacity-50' : 'opacity-100'}`}>
                {savingStatus ? 'מעדכן…' : 'עדכן סטטוס'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[13px] text-subtle-foreground block mb-1.5">הוספת הערה (Dev Comments)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="הטקסט יתווסף לסוף שדה ההערות ב-QC, ולא ידרוס אותו" className={`${inputClass} resize-y`} />
            <div className="mt-1.5 text-left">
              <button onClick={saveNote} disabled={savingNote || !note.trim()} className={`${btnClass} ${(savingNote || !note.trim()) ? 'opacity-50' : 'opacity-100'}`}>
                {savingNote ? 'מוסיף…' : 'הוסף הערה ל-QC'}
              </button>
            </div>
          </div>
          {msg && (
            <div className={`text-[13px] font-semibold ${msg.kind === 'ok' ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </div>
          )}

          <div className="border-t border-border pt-4">
            <div className="text-[13px] text-subtle-foreground mb-2.5">שדות נוספים (Assigned To / Priority / Severity / Estimated Fix Time / Sub Module / Main Module)</div>
            <div className="grid grid-cols-2 gap-3">
              {TIER2_FIELDS.map(f => {
                const options = TIER2_FIELD_OPTIONS[f.key];
                return (
                  <div key={f.key}>
                    <label className="text-[13px] text-subtle-foreground block mb-1.5">{f.label}</label>
                    {options ? (
                      <select
                        value={tier2Values[f.key] ?? ''}
                        onChange={e => setTier2Values(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className={inputClass}
                        dir="ltr"
                      >
                        <option value="">—</option>
                        {options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        value={tier2Values[f.key] ?? ''}
                        onChange={e => setTier2Values(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className={inputClass}
                        dir="ltr"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <button onClick={saveTier2} disabled={savingTier2 || !tier2Dirty} className={`${btnClass} ${(savingTier2 || !tier2Dirty) ? 'opacity-50' : 'opacity-100'}`}>
                {savingTier2 ? 'מעדכן…' : 'שמור שינויים ב-QC'}
              </button>
              {tier2Msg && (
                <div className={`text-[13px] font-semibold ${tier2Msg.kind === 'ok' ? 'text-success' : 'text-danger'}`}>
                  {tier2Msg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// New-defect creation (docs/spec-defects-module.md §5, 2026-09-18) — every
// QA can open this (action:qc_defect_create), but the form is deliberately a
// generic REST-field-name editor, NOT a polished "title/description/
// severity/..." form: the real required-field set and REST field names for
// this QC instance are still unconfirmed (§11 step 1, the metadata probe,
// blocked until real QC access). The one confirmed-safe field is `name`
// (the summary/title) — everything else goes through the same free-text
// field-name rows already used in the admin lab (QcWriteTestPanel), so a
// real attempt can be made now without pretending to know fields we don't.
const CreateDefectModal: React.FC<{ token: string; open: boolean; onClose: () => void; onCreated: (id: string) => void }> = ({ token, open, onClose, onCreated }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [title, setTitle] = useState('');
  const [extraRows, setExtraRows] = useState<FieldRow[]>([{ name: '', value: '' }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTitle(''); setExtraRows([{ name: '', value: '' }]); setError(null); };

  const create = async () => {
    if (!title.trim()) { setError('יש להזין כותרת (Summary)'); return; }
    setCreating(true); setError(null);
    try {
      const fields: Record<string, string> = { name: title.trim() };
      for (const row of extraRows) {
        if (row.name.trim()) fields[row.name.trim()] = row.value;
      }
      const res = await axios.post(`${API}/qc/defects`, { fields }, { headers });
      if (!res.data?.id) {
        setError('התקלה נוצרה ב-QC אך לא זוהה מזהה בתשובה — בדוק ידנית ב-QC UI');
        return;
      }
      reset();
      onCreated(res.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'יצירת התקלה נכשלה');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="תקלה חדשה ב-QC" width={620}>
      <div className="flex flex-col gap-4" dir="rtl">
        <div className="text-[13px] text-subtle-foreground leading-relaxed">
          השדה "כותרת" בלבד מאומת. שאר השדות (חומרה, CR מקושר, שלב בדיקה וכו') נכתבים
          לפי שם ה-REST האמיתי שלהם — לגלות אותם דרך "🔍 הצג את כל שמות השדות" (מסך הניהול)
          לפני שממלאים, אחרת הכתיבה עלולה להיכשל או להיכתב לשדה הלא-נכון.
        </div>
        <div>
          <label className="text-[13px] text-subtle-foreground block mb-1.5">כותרת (Summary)</label>
          <TextField value={title} onChange={e => setTitle(e.target.value)} fullWidth />
        </div>
        <div>
          <label className="text-[13px] text-subtle-foreground block mb-1.5">שדות נוספים (אופציונלי)</label>
          <FieldRowsEditor rows={extraRows} onChange={setExtraRows} />
        </div>
        {error && <div className="text-[13px] font-semibold text-danger">{error}</div>}
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>ביטול</Button>
          <Button onClick={create} disabled={creating || !title.trim()}>{creating ? 'יוצר…' : 'צור תקלה ב-QC'}</Button>
        </div>
      </div>
    </Modal>
  );
};

// Inline sidebar editor (spec 2026-09-19) — swapped in for one field's
// display span on double-click while the sidebar is in edit mode. Renders a
// select for a closed value-list (status via allowedTransitions, else the
// old datalist fallback; severity/priority via TIER2_FIELD_OPTIONS), a plain
// text input otherwise. A select commits immediately on change (choosing IS
// finishing); a text input commits on blur/Enter and reverts on Escape
// without saving — `onCommit` itself is a no-op if the value didn't actually
// change (see commitInlineField).
const InlineFieldEditor: React.FC<{
  fieldKey: string; initialValue: string; currentStatus: string; allowedTransitions: string[] | null;
  onCommit: (value: string) => void; onCancel: () => void;
}> = ({ fieldKey, initialValue, currentStatus, allowedTransitions, onCommit, onCancel }) => {
  const [value, setValue] = useState(initialValue);
  const fieldClass = 'w-full box-border px-1.5 py-1 rounded-sm border border-border text-[13px] bg-card text-foreground';

  if (fieldKey === 'status') {
    if (allowedTransitions) {
      return (
        <select autoFocus value={value} onChange={e => onCommit(e.target.value)} onBlur={onCancel}
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} className={fieldClass} dir="ltr">
          <option value={currentStatus}>{currentStatus} (נוכחי)</option>
          {allowedTransitions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    return (
      <>
        <input autoFocus list="qc-status-options-inline" value={value} onChange={e => setValue(e.target.value)}
          onBlur={() => onCommit(value)} onKeyDown={e => { if (e.key === 'Enter') onCommit(value); if (e.key === 'Escape') onCancel(); }}
          className={fieldClass} dir="ltr" />
        <datalist id="qc-status-options-inline">{QC_STATUS_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
      </>
    );
  }

  const options = TIER2_FIELD_OPTIONS[fieldKey];
  if (options) {
    return (
      <select autoFocus value={value} onChange={e => onCommit(e.target.value)} onBlur={onCancel}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} className={fieldClass} dir="ltr">
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input autoFocus value={value} onChange={e => setValue(e.target.value)}
      onBlur={() => onCommit(value)} onKeyDown={e => { if (e.key === 'Enter') onCommit(value); if (e.key === 'Escape') onCancel(); }}
      className={fieldClass} dir="ltr" />
  );
};

// Full-screen drill-down for one defect — replaces the table view entirely
// (back button, same pattern as CycleProgressView's CycleDetailScreen)
// rather than an inline expand, per the explicit "מסך חדש" requirement.
// Renders whichever fields + order the admin configured (detailFields),
// falling back to every field with a value if the admin never configured one.
// Exported — also reused by release-intelligence/DefectDrilldownModal so
// every "click a defect ID, see full details" path in the app opens the same
// screen instead of a second, drifting copy (spec confirmed 2026-08-29).
//
// NOTE: this whole screen intentionally renders in the "Jira issue" look
// (JIRA.* raw Atlassian hex from theme.ts) rather than the app's own design
// tokens — per theme.ts's comment, that's deliberate for this exact screen,
// so JIRA.* colors below are kept as literal inline style on purpose.
export const DefectDetailScreen: React.FC<{
  defectId: string; detailFields: string[]; token: string; onBack: () => void;
}> = ({ defectId, detailFields, token, onBack }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [detail, setDetail] = useState<DefectFullDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    axios.get(`${API}/qc/open-prod-defect-detail/${encodeURIComponent(defectId)}`, { headers })
      .then(r => setDetail(r.data ?? null))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defectId, token]);

  const currentStatus = String(detail?.status ?? '');

  // Lifted 2026-09-19 from QcWriteBackPanel — the new inline sidebar editor
  // below needs the exact same write-permission probe and workflow-transition
  // list to gate its own "✏️ ערוך" button and status editor, so both surfaces
  // share one fetch each instead of two independent ones.
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}`, { headers })
      .then(() => { if (alive) setBlocked(null); })
      .catch(err => {
        if (!alive) return;
        const code = err?.response?.status;
        if (code === 403 || code === 400) setBlocked(err?.response?.data?.message || 'אין הרשאת כתיבה ל-QC');
      });
    return () => { alive = false; };
  }, [defectId, headers]);

  const [allowedTransitions, setAllowedTransitions] = useState<string[] | null>(null);
  useEffect(() => {
    if (!currentStatus) { setAllowedTransitions(null); return; }
    let alive = true;
    axios.get(`${API}/qc/defects/allowed-transitions`, { headers, params: { currentStatus } })
      .then(r => { if (alive) setAllowedTransitions(r.data?.hasMapping ? r.data.allowed : null); })
      .catch(() => { if (alive) setAllowedTransitions(null); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStatus, defectId]);

  // Inline sidebar field editor (spec 2026-09-19) — one "✏️ ערוך" toggle puts
  // the writable fields (INLINE_EDITABLE_FIELDS) into an editable state;
  // double-clicking one opens its own editor in place (select for a closed
  // value-list, text otherwise); one "💾 שמור" batches every pending field
  // into the minimum number of PATCH calls. The older "עדכון ישיר ל-QC" panel
  // below stays as a fallback (user's explicit call) rather than being removed.
  const [editMode, setEditMode] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const [savingInline, setSavingInline] = useState(false);
  const [inlineMsg, setInlineMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    // A freshly opened/changed defect starts clean — no stale edits carried
    // over from whatever was previously viewed.
    setEditMode(false); setEditingField(null); setPendingEdits({}); setInlineMsg(null);
  }, [defectId]);

  const cancelInlineEdit = () => {
    if (Object.keys(pendingEdits).length > 0 && !window.confirm('לבטל את השינויים שלא נשמרו?')) return;
    setEditMode(false); setEditingField(null); setPendingEdits({}); setInlineMsg(null);
  };

  const commitInlineField = (key: string, value: string) => {
    const original = String((detail as any)?.[key] ?? '');
    setPendingEdits(prev => {
      const next = { ...prev };
      if (value.trim() === original.trim()) delete next[key]; else next[key] = value;
      return next;
    });
    setEditingField(null);
  };

  const saveInlineEdits = async () => {
    if (Object.keys(pendingEdits).length === 0) return;
    setSavingInline(true); setInlineMsg(null);
    const errors: string[] = [];
    const { status: pendingStatus, ...restFields } = pendingEdits;
    if (pendingStatus !== undefined) {
      try {
        await axios.patch(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/status`, { status: pendingStatus }, { headers });
      } catch (err: any) {
        errors.push(err?.response?.data?.message || 'עדכון הסטטוס נכשל');
      }
    }
    if (Object.keys(restFields).length > 0) {
      try {
        await axios.patch(`${API}/qc/defects/${encodeURIComponent(defectId)}/fields`, { fields: restFields }, { headers });
      } catch (err: any) {
        errors.push(err?.response?.data?.message || 'עדכון השדות נכשל');
      }
    }
    setSavingInline(false);
    if (errors.length > 0) { setInlineMsg({ kind: 'err', text: errors.join(' · ') }); return; }
    setDetail(prev => (prev ? ({ ...prev, ...pendingEdits } as DefectFullDetail) : prev));
    setPendingEdits({});
    setEditMode(false);
  };

  // The admin-configured field pool (AdminPanel's "עמודות תקלות ייצור" panel)
  // decides which fields are even available; the per-user category picker
  // below (independent, localStorage-persisted like VersionOverview's) only
  // decides how to show/group whichever of those are available — same
  // separation of concerns as the TARGET-defect screen's two independent
  // pickers (spec confirmed 2026-08-30).
  const fieldsToShow = detailFields.length > 0 ? detailFields : DETAIL_FIELDS.map(f => f.key);
  const titleShown = fieldsToShow.includes('title');
  // The "התאמת שדות" dialog offers the FULL field vocabulary (every
  // TargetDefectDto column), not just the admin-configured `detailFields`
  // subset — user-flagged 2026-09-07 ("לא כל השדות מופיעים ברשימה"). Empty
  // fields are still auto-hidden from the actual panel (detail[k] !== undefined),
  // so surfacing them all in the picker is safe.
  const allColumns = useMemo(
    () => DETAIL_FIELDS.filter(f => !DETAIL_GROUPS_FIXED_FIELDS.has(f.key)).map(f => ({ key: f.key, label: DETAIL_FIELD_LABEL[f.key] ?? f.key })),
    [],
  );
  // Default groups stay lean — only the admin-configured / default field set,
  // NOT the full picker vocabulary (which would fill the panel with empty
  // "—" rows). The "התאמת שדות" dialog is where the rest live.
  const defaultGroups = useMemo(() => {
    const allowed = new Set(fieldsToShow);
    return DEFAULT_OPEN_PROD_DETAIL_GROUPS
      .map(g => ({ ...g, fields: g.fields.filter(k => allowed.has(k)) }))
      .filter(g => g.fields.length > 0);
  }, [fieldsToShow]);

  const [detailGroups, setDetailGroups] = useState<DetailGroup[]>(() => {
    try {
      const saved = localStorage.getItem(DETAIL_GROUPS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return defaultGroups;
  });
  const [showGroupsPicker, setShowGroupsPicker] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const applyDetailGroups = (groups: DetailGroup[]) => {
    setDetailGroups(groups);
    localStorage.setItem(DETAIL_GROUPS_STORAGE_KEY, JSON.stringify(groups));
    setShowGroupsPicker(false);
  };

  const showDescription = fieldsToShow.includes('description');
  const showNotes = fieldsToShow.includes('notes');

  return (
    <div className="px-7 py-5">
      {/* ── סרגל פעולות עליון — כפתורי משנה קומפקטיים ── */}
      <div className="flex items-center justify-between mb-[18px]">
        <BackLink onClick={onBack} label="חזרה לטבלה" />
        <div className="flex items-center gap-2">
          {inlineMsg && (
            <span className={`text-[13px] font-semibold ${inlineMsg.kind === 'ok' ? 'text-success' : 'text-danger'}`}>{inlineMsg.text}</span>
          )}
          {!blocked && (
            editMode ? (
              <>
                <button onClick={cancelInlineEdit} className={DETAIL_TOP_BTN_CLASS}>ביטול</button>
                <button
                  onClick={saveInlineEdits}
                  disabled={savingInline || Object.keys(pendingEdits).length === 0}
                  className={`px-3.5 py-1.5 rounded-md border-none cursor-pointer text-[13px] font-semibold bg-primary text-white ${(savingInline || Object.keys(pendingEdits).length === 0) ? 'opacity-50' : 'opacity-100'}`}
                >
                  {savingInline ? 'שומר…' : `💾 שמור${Object.keys(pendingEdits).length > 0 ? ` (${Object.keys(pendingEdits).length})` : ''}`}
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)} className={DETAIL_TOP_BTN_CLASS}>✏️ ערוך</button>
            )
          )}
          <button onClick={() => setShowGroupsPicker(true)} className={DETAIL_TOP_BTN_CLASS}>⚙ התאמת שדות</button>
        </div>
      </div>

      {detailLoading && <div className="text-center p-10 text-subtle-foreground">טוען...</div>}
      {!detailLoading && !detail && (
        <div className="text-center p-10 text-subtle-foreground">לא נמצא מידע מלא עבור תקלה זו</div>
      )}

      {!detailLoading && detail && (
        // Explicit dir="ltr" + aside listed FIRST so the layout order is
        // deterministic: the field panel (1st child) on the left, main
        // content (2nd child) on the right (feedback 2026-09-14: the panel
        // should be on the left, not the right — corrected from an earlier
        // pass that had this backwards). On wrap, main stays on top and the
        // panel drops below it.
        <div className="flex flex-wrap items-start gap-7" dir="ltr">
          {/* ══ סרגל צד (Issue panel) — רקע אפור Atlassian, תווית קטנה מעל הערך ══ */}
          {/* dir="rtl" — the panel's own chrome (group titles, attachments
              heading, history button) is untranslated Hebrew UI text with no
              per-element direction marking of its own. Combined with an RTL
              grid, listing the value span before the label span in each row
              below places the label on the left and the value on the right
              (feedback 2026-09-14: "כל התוויות משמאל הערכים מימין לתווית"). */}
          <aside
            dir="rtl"
            // Widened 300→380px (main content correspondingly narrowed below)
            // and the label column changed from a 40%-capped percentage to
            // max-content (2026-09-18) — long English labels ("Environment
            // Component", "CR/HBR Number reference") were wrapping to a
            // second line at the old width/ratio; max-content sizes the
            // label column to whatever the longest visible label needs, so
            // it never wraps regardless of aside width.
            className="flex-[0_0_380px] max-w-[380px] self-start rounded-lg overflow-hidden"
            style={{ background: '#fff', border: `1px solid ${JIRA.greyN40}` }}
          >
            {(() => {
              const groups = detailGroups
                .map(g => ({ ...g, fields: g.fields.filter(k => detail[k] !== undefined) }))
                .filter(g => g.fields.length > 0);
              return groups.map((group, gi) => (
                <div key={group.title} className="px-4 py-3" style={{ borderBottom: gi < groups.length - 1 ? `1px solid ${JIRA.greyN40}` : 'none' }}>
                  <div className="text-[11px] font-bold tracking-wide mb-2.5" style={{ color: JIRA.textSubtle }}>
                    {group.title}
                  </div>
                  <div className="flex flex-col gap-2">
                    {group.fields.map(key => {
                      const isDirty = pendingEdits[key] !== undefined;
                      const displayValue = isDirty ? pendingEdits[key] : String(detail[key] ?? '');
                      const isAtomic = PERSON_BADGE_FIELDS.has(key) || TEAM_BADGE_FIELDS.has(key)
                        || key === 'id' || key === 'status' || key === 'severity' || key === 'priority' || key === 'secondaryPriority';
                      const valRtl = !isAtomic && (!displayValue || hasHebrew(displayValue));
                      const isEditable = editMode && INLINE_EDITABLE_FIELDS.has(key);
                      const isEditingThis = editingField === key;
                      // Side-by-side (label ⟷ value) to keep the panel short — user
                      // pref 2026-09-08; the Jira brief allowed "מעליה/לצידה". A
                      // dashed outline marks which fields double-click opens while
                      // in edit mode (spec 2026-09-19); a dot flags an edit that's
                      // committed locally but not yet sent to QC via "💾 שמור".
                      return (
                        <div
                          key={key}
                          onDoubleClick={() => { if (isEditable && !isEditingThis) setEditingField(key); }}
                          className="grid gap-2 items-start rounded-sm px-1 py-0.5 -mx-1"
                          style={{
                            gridTemplateColumns: 'minmax(0,1fr) max-content',
                            border: isEditable && !isEditingThis ? `1px dashed ${JIRA.blue}` : '1px solid transparent',
                            cursor: isEditable && !isEditingThis ? 'pointer' : undefined,
                            background: isDirty ? '#fffbe6' : undefined,
                          }}
                        >
                          {isEditingThis ? (
                            <InlineFieldEditor
                              fieldKey={key}
                              initialValue={displayValue}
                              currentStatus={currentStatus}
                              allowedTransitions={allowedTransitions}
                              onCommit={v => commitInlineField(key, v)}
                              onCancel={() => setEditingField(null)}
                            />
                          ) : (
                            <span
                              className="text-[13px] font-medium min-w-0 flex items-center flex-wrap gap-1 justify-end break-words"
                              style={{ color: JIRA.text, direction: 'rtl', unicodeBidi: valRtl ? 'normal' : 'plaintext' }}
                            >
                              {isDirty && <span title="שינוי לא שמור" style={{ color: JIRA.blue }}>●</span>}
                              {renderFieldValue(key, displayValue)}
                            </span>
                          )}
                          <span className="whitespace-nowrap text-[11px] font-semibold tracking-wide text-left pt-0.5" style={{ color: JIRA.textSubtle }}>
                            {DETAIL_FIELD_LABEL[key] ?? key}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}

            {/* קבצים מצורפים — האינדיקציה + הרשימה בתוך החלונית */}
            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }}>
              <AttachmentsSection defectId={defectId} token={token} />
            </div>

            {/* היסטוריית שינויים — כפתור שפותח את הטבלה בחלון מודאלי */}
            <div className="px-4 py-3">
              <button
                onClick={() => setHistoryModalOpen(true)}
                className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer p-0 text-[13px] font-bold"
                style={{ color: JIRA.blue }}
              >
                <span>🕘 היסטוריית שינויים</span>
                <span aria-hidden>←</span>
              </button>
            </div>
          </aside>

          {/* ══ תוכן מרכזי (≈70%) — צד ימין ══ */}
          {/* מסגרת לבנה אחידה לכל האזור (feedback 2026-09-14) — תואמת את
              המסגרת הלבנה של החלונית משמאל, כך ששני הצדדים נראים כזוג
              כרטיסים תואמים. תיאור/הערות כבר לא צריכים תיבה לבנה משלהם
              (הייתה יוצרת תיבה בתוך תיבה) — רק המרווח הפנימי נשאר. */}
          <div
            className="flex-[1_1_480px] min-w-0 flex flex-col gap-6 rounded-lg px-6 py-5"
            style={{ background: '#fff', border: `1px solid ${JIRA.greyN40}` }}
          >

            {/* כותרת */}
            {(() => {
              const titleText = titleShown ? (detail.title || 'ללא כותרת') : 'פרטי תקלה';
              const titleRtl = hasHebrew(titleText);
              return (
                <div>
                  <div
                    className={cn('text-xl font-semibold leading-snug break-words', titleRtl ? 'text-right [direction:rtl]' : 'text-left [direction:ltr]')}
                    style={{ color: JIRA.text }}
                  >
                    {titleText}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold inline-block" style={{ color: JIRA.blue, direction: 'ltr' }}>#{defectId}</span>
                  </div>
                </div>
              );
            })()}

            {/* תיאור — טקסט עשיר מפוענח */}
            {showDescription && (
              <section>
                <div className={DETAIL_SECTION_HEADING_CLASS} style={{ color: JIRA.textSubtle }}>{DETAIL_FIELD_LABEL.description ?? 'תיאור'}</div>
                <div
                  className="text-[15px] leading-relaxed text-right whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto"
                  style={{ color: JIRA.text }}
                >
                  {detail.description ? decodeDefectText(String(detail.description)) : '—'}
                </div>
              </section>
            )}

            {/* הערות מפתח — פיד כרונולוגי, גובה חסום עם גלילה פנימית כדי שהדף
                עצמו לא יתארך (כותב + תאריך מודגשים, ואז הגוף) */}
            {showNotes && (() => {
              const noteCount = String(detail.notes ?? '').split(/_{5,}/).map(s => s.trim()).filter(Boolean).length;
              return (
                <section>
                  <div className={DETAIL_SECTION_HEADING_CLASS} style={{ color: JIRA.textSubtle }}>
                    {DETAIL_FIELD_LABEL.notes ?? 'הערות מפתח'}{noteCount > 1 ? ` · ${noteCount}` : ''}
                  </div>
                  <div className="leading-relaxed max-h-[440px] overflow-y-auto">
                    {renderNotesField(detail.notes)}
                  </div>
                </section>
              );
            })()}

            {/* עדכון ישיר ל-QC — פתוח כברירת מחדל (spec 2026-09-07) */}
            <QcWriteBackPanel
              defectId={defectId}
              token={token}
              currentStatus={currentStatus}
              currentValues={{
                assignedTo: String(detail.assignedTo ?? ''),
                priority: String(detail.priority ?? ''),
                severity: String(detail.severity ?? ''),
                estimatedFixTime: String(detail.estimatedFixTime ?? ''),
                subModule: String(detail.subModule ?? ''),
                mainModule: String(detail.mainModule ?? ''),
              }}
              blocked={blocked}
              allowedTransitions={allowedTransitions}
            />
          </div>
        </div>
      )}

      {historyModalOpen && (
        <div
          onClick={() => setHistoryModalOpen(false)}
          className="fixed inset-0 bg-black/50 z-[5000] flex items-center justify-center p-6"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-lg px-5 py-[18px] w-[760px] max-w-[96vw] max-h-[86vh] overflow-y-auto shadow-xl"
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[15px] font-bold text-foreground">היסטוריית שינויים — תקלה {defectId}</div>
              <button onClick={() => setHistoryModalOpen(false)} className="bg-transparent border-none cursor-pointer text-lg text-subtle-foreground leading-none">✕</button>
            </div>
            <FieldChangeHistorySection defectId={defectId} token={token} defaultOpen />
          </div>
        </div>
      )}

      {showGroupsPicker && (
        <DetailGroupsDialog
          allColumns={allColumns}
          groups={detailGroups}
          defaultGroups={defaultGroups}
          onApply={applyDetailGroups}
          onClose={() => setShowGroupsPicker(false)}
        />
      )}
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string; color: string; onClick?: () => void }> = ({ label, value, color, onClick }) => (
  <Card padding={4} onClick={onClick} style={{ flex: 1, minWidth: '110px', textAlign: 'center' }}>
    <div className="text-xs text-subtle-foreground mb-1 whitespace-nowrap">{label}</div>
    <div className="text-[32px] font-bold leading-tight" style={{ color }}>{value}</div>
  </Card>
);

const BreakdownPanel: React.FC<{ title: string; total: number; rows: { label: string; count: number }[] }> = ({ title, total, rows }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <Card padding={4} style={{ flex: 1, minWidth: '260px' }}>
      <div className="flex justify-between items-center mb-2.5">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Badge color={C.textMuted} bg={C.bgHover}>{total}</Badge>
      </div>
      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto">
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground w-[140px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap" title={r.label}>{r.label}</div>
            <div className="flex-1 h-3.5 bg-muted rounded-sm overflow-hidden">
              <div className="h-full bg-primary rounded-sm" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="text-xs text-foreground w-6 text-left">{r.count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const MIN_POINT_GAP = 26; // px between points before the chart starts scrolling instead of squeezing

// NOT migrated — left exactly as-is (byte-for-byte, only pre-existing
// formatting). Every position in this chart (point x/y, tooltip placement,
// polyline, label spacing) is computed from pixel/percentage math tied
// directly to the data's months/counts, which the migration brief says to
// leave untouched rather than guess at converting safely.
const MonthlyTrendChart: React.FC<{
  data: { monthLabel: string; count: number }[];
  selectedMonth: string | null;
  onSelectMonth: (m: string) => void;
}> = ({ data, selectedMonth, onSelectMonth }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(760);

  // Measures the actual rendered width so the viewBox can match it exactly —
  // with few points (worst case: a single filtered month), the old fixed
  // 760px-minimum viewBox got stretched non-uniformly (preserveAspectRatio=
  // none) to fill a much wider real container, smearing text/circles
  // horizontally. Matching viewBox width to the real container keeps the
  // stretch factor at ~1 (no distortion) whenever there's room to.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0) {
    return <div style={{ ...{ fontSize: '16px', lineHeight: '23px' }, color: C.textMuted, fontFamily: FONT, padding: '20px', textAlign: 'center' }}>אין נתוני מגמה</div>;
  }

  // padTop reserves room for the two-line tooltip above the highest point —
  // the wrapping div needs overflowX:auto for wide charts to scroll instead
  // of squeeze, and per the CSS overflow spec that silently forces overflowY
  // to 'auto' too (setting it to 'visible' explicitly does NOT override this
  // — confirmed live: the browser still clips), so anything drawn above y=0
  // gets cut off no matter what. Reserving enough top margin that even the
  // max-value point's tooltip box never goes negative is what actually fixes
  // it, not fighting the overflow computation.
  const height = 340, padX = 36, padTop = 50, padBottom = 24;
  const width = Math.max(containerWidth, padX * 2 + (data.length - 1) * MIN_POINT_GAP);
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padBottom - (d.count / max) * (height - padTop - padBottom);
    return { x, y, d };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  // Selective x-axis labels only — one point every ~90px, plus always the last
  // point — never a label on every point (that's what produced the unreadable
  // wall of overlapping text).
  const labelEvery = Math.max(1, Math.ceil(90 / (stepX || 90)));
  const activeIdx = hoverIdx ?? points.findIndex(p => p.d.monthLabel === selectedMonth);
  const activePoint = activeIdx >= 0 ? points[activeIdx] : null;

  return (
    <div ref={wrapRef} style={{ overflowX: 'auto' }}>
      {/* viewBox width now tracks the real measured container width (see
          ResizeObserver above), so preserveAspectRatio="none" below only
          ever stretches when there are more points than fit naturally —
          scroll (via minWidth) kicks in there instead of squeezing.
          With few points (viewBox width == container width), the stretch
          factor is ~1 and text/circles render undistorted — this is what
          fixes the "smeared" single-point chart (2026-08-27). Original
          "fill the card instead of sitting flush to one side" fix: found
          live in production 2026-08-05. */}
      <svg
        viewBox={`0 0 ${width} ${height + 10}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible', display: 'block', width: '100%', minWidth: width, height: height + 10 }}
      >
        <polyline points={polyline} fill="none" stroke={C.brand} strokeWidth={2} />
        {points.map((p, i) => {
          const isSelected = p.d.monthLabel === selectedMonth;
          const showLabel = i === points.length - 1 || i % labelEvery === 0;
          return (
            <g key={i}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectMonth(p.d.monthLabel)}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Wider invisible hit-target so hovering doesn't require pixel-perfect aim */}
              <rect x={p.x - stepX / 2} y={0} width={stepX || 20} height={height} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={isSelected ? 6 : 3} fill={isSelected ? C.danger : C.brand} />
              {showLabel && (
                <text x={p.x} y={height - 4} fontSize="11" fill={isSelected ? C.danger : C.textMuted} fontWeight={isSelected ? 'bold' : 'normal'} textAnchor="middle" fontFamily={FONT}>
                  {p.d.monthLabel}
                </text>
              )}
            </g>
          );
        })}
        {/* Tooltip shown only for the hovered/selected point — never all of them
            at once. Shows both the month and the count together (not just the
            count) so hovering answers "which month, how many" in one glance. */}
        {activePoint && (
          <g pointerEvents="none">
            <rect x={activePoint.x - 34} y={activePoint.y - 42} width={68} height={32} rx={5} fill={C.textPrimary} />
            <text x={activePoint.x} y={activePoint.y - 27} fontSize="11" fill={C.bgCard} textAnchor="middle" fontFamily={FONT}>
              {activePoint.d.monthLabel}
            </text>
            <text x={activePoint.x} y={activePoint.y - 13} fontSize="13" fill={C.bgCard} textAnchor="middle" fontFamily={FONT} fontWeight="bold">
              {activePoint.d.count} תקלות
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};

// Compact multi-select dropdown — "הכל" when nothing is picked (no filtering),
// otherwise a checkbox list of every option plus a live count of selections.
const MultiSelectFilter: React.FC<{
  label: string; options: string[]; selected: string[]; onChange: (next: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt]);
  };

  const allSelected = options.length > 0 && selected.length === options.length;

  return (
    <div ref={ref} className="relative flex-1 min-w-[150px]">
      <button onClick={() => setOpen(o => !o)} className={`${selectClass} w-full flex items-center justify-between gap-2 cursor-pointer`}>
        <span>{label} — {selected.length === 0 ? 'הכל' : `נבחרו ${selected.length}`}</span>
        <span className="text-[11px] text-subtle-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute top-full end-0 z-20 mt-0.5 bg-card border border-border rounded-md min-w-[200px] max-h-[300px] overflow-y-auto shadow-md p-1.5">
          <div className="flex gap-2.5 px-2 py-1.5 border-b border-border mb-1">
            <span
              onClick={() => options.length > 0 && onChange(options)}
              className={`text-xs font-semibold ${allSelected ? 'text-subtle-foreground cursor-default' : 'text-primary cursor-pointer'}`}
            >
              ✓ בחר הכל
            </span>
            <span
              onClick={() => selected.length > 0 && onChange([])}
              className={`text-xs font-semibold ${selected.length === 0 ? 'text-subtle-foreground cursor-default' : 'text-primary cursor-pointer'}`}
            >
              ✕ נקה הכל
            </span>
          </div>
          {options.map(o => (
            <label key={o} className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-sm text-foreground">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
          {options.length === 0 && <div className="text-xs text-subtle-foreground px-2 py-1.5">אין אפשרויות</div>}
        </div>
      )}
    </div>
  );
};

function groupCount(items: OpenProdDefectMonthRow[], keyFn: (r: OpenProdDefectMonthRow) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) || 'ללא סיווג';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export const OpenProdDefectsView: React.FC<Props> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rows, setRows] = useState<OpenProdDefectMonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qcMock, setQcMock] = useState(true);

  const [fResponsibility, setFResponsibility] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fYear, setFYear] = useState<string[]>([]);
  const [fFixType, setFFixType] = useState<string[]>([]);
  const [fBugType, setFBugType] = useState<string[]>([]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [detailDefectId, setDetailDefectId] = useState<string | null>(null);
  // Drill-down navigation: overview (KPI cards + chart + breakdown panels) →
  // click a KPI card → separate table page, optionally pre-filtered to that
  // card's severity (null = the "סה"כ" card, i.e. no severity restriction).
  const [tableOpen, setTableOpen] = useState(false);
  const [presetSeverity, setPresetSeverity] = useState<string | null>(null);
  const openTable = (severity: string | null) => { setPresetSeverity(severity); setTableOpen(true); };
  const [config, setConfig] = useState<OpenProdDefectsConfig | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Bulk status update (docs/spec-defects-module.md §11, lowest priority —
  // kept deliberately simple: free-text/datalist target status, not trying
  // to compute a unified allowed-transition set across rows that may each
  // be at a different current status.
  const [selectedDefectIds, setSelectedDefectIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const toggleSelected = (id: string) => setSelectedDefectIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const applyBulkStatus = async () => {
    if (!bulkStatus.trim() || selectedDefectIds.size === 0) return;
    setBulkApplying(true);
    try {
      const res = await axios.post(
        `${API}/qc/defects/bulk-status`,
        { defectIds: Array.from(selectedDefectIds), newStatus: bulkStatus.trim() },
        { headers },
      );
      const { updated, failed } = res.data as { updated: any[]; failed: { defectId: string; error: string }[] };
      const lines = [`עודכנו בהצלחה: ${updated.length}`];
      if (failed.length > 0) lines.push(`נכשלו: ${failed.length}\n${failed.map(f => `${f.defectId}: ${f.error}`).join('\n')}`);
      window.alert(lines.join('\n\n'));
      setSelectedDefectIds(new Set());
      setBulkStatus('');
    } catch (e: any) {
      window.alert(e?.response?.data?.message ?? 'עדכון קבוצתי נכשל');
    } finally {
      setBulkApplying(false);
    }
  };

  useEffect(() => {
    axios.get(`${API}/qc/status`, { headers })
      .then(r => setQcMock(!r.data?.enabled))
      .catch(() => setQcMock(true));
  }, [headers]);

  useEffect(() => {
    axios.get(`${API}/qc/open-prod-defects-config`, { headers })
      .then(r => setConfig(r.data))
      .catch(() => setConfig(null));
  }, [headers]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/qc/open-production-defects-history`, { headers })
      .then(r => setRows(r.data ?? []))
      .catch(err => setError(err?.response?.data?.message || 'שגיאה בטעינת נתוני תקלות ייצור'))
      .finally(() => setLoading(false));
  }, [headers]);

  // ── Filter option lists (derived from the full dataset, not the filtered one) ──
  const responsibilityOptions = useMemo(() => Array.from(new Set(rows.map(r => r.responsibility).filter(Boolean))).sort() as string[], [rows]);
  const statusOptions         = useMemo(() => Array.from(new Set(rows.map(r => r.statusAtMonth).filter(Boolean))).sort() as string[], [rows]);
  const yearOptions           = useMemo(() => Array.from(new Set(rows.map(r => r.monthLabel.slice(0, 4)).filter(Boolean))).sort() as string[], [rows]);
  const fixTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.fixType).filter(Boolean))).sort() as string[], [rows]);
  const bugTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.bugType).filter(Boolean))).sort() as string[], [rows]);

  const filteredRows = useMemo(() => rows.filter(r =>
    (fResponsibility.length === 0 || fResponsibility.includes(r.responsibility || '')) &&
    (fStatus.length === 0 || fStatus.includes(r.statusAtMonth || '')) &&
    (fYear.length === 0 || fYear.some(y => r.monthLabel.startsWith(y))) &&
    (fFixType.length === 0 || fFixType.includes(r.fixType || '')) &&
    (fBugType.length === 0 || fBugType.includes(r.bugType || ''))
  ), [rows, fResponsibility, fStatus, fYear, fFixType, fBugType]);

  const monthlyTrend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filteredRows) counts.set(r.monthLabel, (counts.get(r.monthLabel) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([monthLabel, count]) => ({ monthLabel, count }))
      .sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
  }, [filteredRows]);

  const latestMonth = monthlyTrend.length > 0 ? monthlyTrend[monthlyTrend.length - 1].monthLabel : null;
  const activeMonth = selectedMonth ?? latestMonth;

  const monthRows = useMemo(() => filteredRows.filter(r => r.monthLabel === activeMonth), [filteredRows, activeMonth]);

  const severityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of monthRows) { const s = r.severity || 'ללא סיווג'; m.set(s, (m.get(s) ?? 0) + 1); }
    return m;
  }, [monthRows]);

  const toggleSort = useCallback((key: string) => {
    setSortDir(prevDir => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
  }, [sortKey]);

  // Admin sets the default column set (config.tableColumns); an end user can
  // override it for themselves via the "⚙ בחירת עמודות" picker below — same
  // per-user-over-admin-default convention as the field-category pickers
  // elsewhere in this module. null = no personal override yet.
  const [userTableColumns, setUserTableColumns] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem(OPENPROD_TABLE_COLUMNS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return null;
  });
  const [showTableColumnPicker, setShowTableColumnPicker] = useState(false);
  const applyTableColumns = (keys: string[]) => {
    setUserTableColumns(keys);
    try { localStorage.setItem(OPENPROD_TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(keys)); } catch { /* ignore quota errors */ }
    setShowTableColumnPicker(false);
  };
  const tableColumns = userTableColumns ?? (config?.tableColumns && config.tableColumns.length > 0 ? config.tableColumns : ['defectId', 'severity', 'responsibility', 'area', 'bugType', 'statusAtMonth', 'detectedDate', 'reopenYn']);

  // The table page's dataset — monthRows further narrowed by whichever
  // severity KPI card the user clicked to get here (null = "סה"כ", no restriction).
  const baseRows = useMemo(
    () => presetSeverity ? monthRows.filter(r => r.severity === presetSeverity) : monthRows,
    [monthRows, presetSeverity],
  );

  const { getWidth: getMonthColWidth, startResize: startMonthColResize } = useColumnWidths('deploycenter_openprod_defect_column_widths');
  const monthFilters = useColumnFilters(baseRows as any, tableColumns);

  // Saved views — capture/restore columns+sort+filters together as one named
  // preset. Storage only (no server sync) — per-browser like every other
  // picker in this screen.
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const saved = localStorage.getItem(OPENPROD_SAVED_VIEWS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return [];
  });
  const [showSavedViews, setShowSavedViews] = useState(false);
  const persistSavedViews = (views: SavedView[]) => {
    setSavedViews(views);
    try { localStorage.setItem(OPENPROD_SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views)); } catch { /* ignore quota errors */ }
  };
  const saveCurrentView = () => {
    const name = window.prompt('שם לתצוגה השמורה:');
    if (!name?.trim()) return;
    const view: SavedView = { name: name.trim(), columns: tableColumns, sortKey, sortDir, filterState: monthFilters.getFilterState() };
    persistSavedViews([...savedViews.filter(v => v.name !== view.name), view]);
  };
  const loadSavedView = (view: SavedView) => {
    setUserTableColumns(view.columns);
    setSortKey(view.sortKey as any);
    setSortDir(view.sortDir);
    monthFilters.setFilterState(view.filterState);
    setShowSavedViews(false);
  };
  const deleteSavedView = (name: string) => persistSavedViews(savedViews.filter(v => v.name !== name));

  const sortedMonthRows = useMemo(() => {
    const filtered = baseRows.filter(r => monthFilters.matches(r as any));
    if (!sortKey) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = String((a as any)[sortKey] ?? '');
      const bv = String((b as any)[sortKey] ?? '');
      return av.localeCompare(bv, 'he') * dir;
    });
  }, [baseRows, sortKey, sortDir, monthFilters.matches]);

  if (detailDefectId) {
    return (
      <DefectDetailScreen
        defectId={detailDefectId}
        detailFields={config?.detailFields ?? []}
        token={token}
        onBack={() => setDetailDefectId(null)}
      />
    );
  }

  // ── Table page — reached by clicking a KPI card on the overview below.
  // Same table as before, just on its own screen instead of always inline. ──
  if (tableOpen) {
    return (
      <div className="flex flex-col gap-4 px-7 py-5">
        <div className="flex items-center justify-between">
          <BackLink onClick={() => setTableOpen(false)} label="חזרה לסקירה" />
          <div className="flex items-center gap-2 relative">
            <button onClick={() => setShowCreateModal(true)} className={DETAIL_TOP_BTN_CLASS}>+ תקלה חדשה</button>
            <button onClick={() => setShowTableColumnPicker(true)} className={DETAIL_TOP_BTN_CLASS}>⚙ בחירת עמודות</button>
            <button onClick={() => setShowSavedViews(s => !s)} className={DETAIL_TOP_BTN_CLASS}>👁 תצוגות שמורות</button>
            {showSavedViews && (
              <div
                className="absolute top-full left-0 mt-1 w-64 rounded-md bg-card shadow-lg z-10 p-2"
                style={{ border: `1px solid ${JIRA.greyN40}` }}
              >
                <button onClick={saveCurrentView} className="w-full text-right px-2 py-1.5 text-xs font-semibold text-primary cursor-pointer hover:bg-muted rounded-sm">
                  + שמור תצוגה נוכחית
                </button>
                {savedViews.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-subtle-foreground">אין תצוגות שמורות עדיין</div>
                ) : (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {savedViews.map(v => (
                      <div key={v.name} className="flex items-center justify-between gap-1 rounded-sm px-2 py-1.5 hover:bg-muted">
                        <button onClick={() => loadSavedView(v)} className="text-xs text-foreground cursor-pointer text-right flex-1">{v.name}</button>
                        <button onClick={() => deleteSavedView(v.name)} title="מחק" className="text-xs text-danger cursor-pointer">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <CreateDefectModal
          token={token}
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={(id) => { setShowCreateModal(false); setDetailDefectId(id); }}
        />
        <Card>
          <div className="text-sm font-semibold text-foreground mb-2.5">
            תקלות פתוחות — {activeMonth ?? '—'}{presetSeverity ? ` — חומרה: ${presetSeverity}` : ''} ({baseRows.length}) — לחץ על כותרת עמודה למיון, לחץ על שורה לפרטים מלאים
          </div>
          {selectedDefectIds.size > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5 rounded-md bg-muted px-3 py-2">
              <span className="text-[13px] font-semibold text-foreground">{selectedDefectIds.size} תקלות נבחרו</span>
              <input
                list="qc-status-options"
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value)}
                placeholder="סטטוס יעד"
                dir="ltr"
                className="w-[160px] rounded-sm border border-border bg-card px-2 py-1 text-xs text-foreground"
              />
              <button
                onClick={applyBulkStatus}
                disabled={bulkApplying || !bulkStatus.trim()}
                className={`px-3 py-1 rounded-sm border-none text-xs font-semibold text-white ${(bulkApplying || !bulkStatus.trim()) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                style={{ background: JIRA.blue }}
              >
                {bulkApplying ? 'מעדכן…' : 'עדכן סטטוס לנבחרים'}
              </button>
              <button onClick={() => setSelectedDefectIds(new Set())} className="px-3 py-1 rounded-sm border border-border bg-card text-xs cursor-pointer">
                נקה בחירה
              </button>
              <datalist id="qc-status-options">
                {QC_STATUS_OPTIONS.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          )}
          <div className="bg-card rounded-lg overflow-hidden" style={{ border: `1px solid ${JIRA.greyN40}` }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-center" style={{ borderBottom: `2px solid ${JIRA.greyN40}`, width: 32 }}>
                      <input
                        type="checkbox"
                        checked={sortedMonthRows.length > 0 && sortedMonthRows.every(r => selectedDefectIds.has(r.defectId))}
                        onChange={e => setSelectedDefectIds(e.target.checked ? new Set(sortedMonthRows.map(r => r.defectId)) : new Set())}
                      />
                    </th>
                    {tableColumns.map(key => (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className="relative px-2 py-2 text-right font-bold text-[11px] tracking-wide cursor-pointer select-none whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ color: JIRA.textSubtle, borderBottom: `2px solid ${JIRA.greyN40}`, width: getMonthColWidth(key) }}
                      >
                        {TABLE_FIELD_LABEL[key] ?? key}
                        {sortKey === key && <span className="me-1 text-primary">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                        <ColumnResizeHandle onMouseDown={e => startMonthColResize(key, e)} />
                      </th>
                    ))}
                  </tr>
                  <ColumnFilterRow
                    columns={tableColumns.map(key => ({ key, label: TABLE_FIELD_LABEL[key] ?? key }))}
                    getWidth={getMonthColWidth}
                    filters={monthFilters}
                  />
                </thead>
                <tbody>
                  {sortedMonthRows.map(r => (
                    // Row hover kept as imperative onMouseEnter/onMouseLeave — the
                    // Jira row-hover color (JIRA.rowHover) is a raw Atlassian
                    // token, not a Tailwind hover: class, and this mirrors the
                    // same technique used elsewhere for that exact tint.
                    <tr
                      key={r.defectId}
                      onClick={() => setDetailDefectId(r.defectId)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = JIRA.rowHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-2 py-[7px] text-center" style={{ borderBottom: `1px solid ${JIRA.greyN40}` }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedDefectIds.has(r.defectId)} onChange={() => toggleSelected(r.defectId)} />
                      </td>
                      {tableColumns.map(key => {
                        const value = (r as any)[key];
                        const isDefectCol = key === 'defectId';
                        const isSeverityCol = key === 'severity';
                        const isStatusCol = key === 'statusAtMonth' || key === 'currentStatus';
                        return (
                          <td
                            key={key}
                            className={`px-2 py-[7px] overflow-hidden text-ellipsis whitespace-nowrap ${isDefectCol || isSeverityCol || isStatusCol ? 'text-center' : ''} ${isDefectCol ? 'font-semibold' : 'font-normal'}`}
                            style={{
                              borderBottom: `1px solid ${JIRA.greyN40}`,
                              width: getMonthColWidth(key),
                              color: isDefectCol || isSeverityCol || isStatusCol ? undefined : JIRA.text,
                            }}
                          >
                            {isDefectCol ? (value ? <IssueKeyLink id={value} /> : '—')
                              : isSeverityCol ? <SeverityBadge severity={value ?? ''} />
                              : isStatusCol ? <StatusBadge status={value ?? ''} />
                              : (value ?? '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {sortedMonthRows.length === 0 && (
                    <tr><td colSpan={tableColumns.length + 1} className="p-3.5 text-center text-subtle-foreground">אין תקלות פתוחות בחודש זה</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
        {showTableColumnPicker && (
          <SelectColumnsDialog
            allColumns={TABLE_COLUMN_FIELDS.map(f => ({ key: f.key, label: TABLE_FIELD_LABEL[f.key] ?? f.label }))}
            visibleKeys={tableColumns}
            onApply={applyTableColumns}
            onClose={() => setShowTableColumnPicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      <Card>
        <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
          <span className="text-[27px]">📆</span>
          <div className="text-xl font-bold text-foreground">תקלות ייצור פתוחות בכל חודש</div>
          {qcMock && (
            <span className="text-base bg-warning-bg text-warning px-2.5 py-[3px] rounded-[10px] border border-warning/30">Mock — ממתין לחיבור QC</span>
          )}
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <MultiSelectFilter label="Responsibility" options={responsibilityOptions} selected={fResponsibility} onChange={setFResponsibility} />
          <MultiSelectFilter label="Status" options={statusOptions} selected={fStatus} onChange={setFStatus} />
          <MultiSelectFilter label="Year" options={yearOptions} selected={fYear} onChange={setFYear} />
          <MultiSelectFilter label="Fix Type" options={fixTypeOptions} selected={fFixType} onChange={setFFixType} />
          <MultiSelectFilter label="Type" options={bugTypeOptions} selected={fBugType} onChange={setFBugType} />
        </div>
      </Card>

      {loading && <div className="text-center p-6 text-subtle-foreground">טוען...</div>}
      {error && <div className="text-center p-6 text-danger">{error}</div>}

      {!loading && !error && (
        <>
          <div className="flex gap-2.5 flex-wrap">
            <KpiCard label={`סה"כ (${activeMonth ?? '—'})`} value={String(monthRows.length)} color={C.textPrimary} onClick={() => openTable(null)} />
            {(['Show Stopper', 'Severe', 'Medium', 'Low'] as const).map(s => (
              <KpiCard key={s} label={s} value={String(severityCounts.get(s) ?? 0)} color={SEVERITY_COLOR[s]} onClick={() => openTable(s)} />
            ))}
          </div>

          <Card>
            <div className="text-sm font-semibold text-foreground mb-2">
              מגמה חודשית — לחץ על נקודה כדי לראות את התקלות של אותו חודש
            </div>
            <MonthlyTrendChart data={monthlyTrend} selectedMonth={activeMonth} onSelectMonth={setSelectedMonth} />
          </Card>

          <div className="flex gap-3 flex-wrap">
            <BreakdownPanel title="לפי אזור" total={monthRows.length} rows={groupCount(monthRows, r => r.area)} />
            <BreakdownPanel title="לפי צוות" total={monthRows.length} rows={groupCount(monthRows, r => r.responsibility)} />
            <BreakdownPanel title="לפי סוג תקלה" total={monthRows.length} rows={groupCount(monthRows, r => r.bugType)} />
          </div>
        </>
      )}
    </div>
  );
};

const selectClass = 'px-2.5 py-[7px] border border-border rounded-md text-[17px] bg-card text-foreground min-w-[150px]';

export default OpenProdDefectsView;
