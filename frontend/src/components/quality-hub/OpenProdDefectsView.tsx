import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { C, FONT, JIRA } from '../../theme';
import { Card, Badge, BackLink, Avatar } from '../ui';
import { TABLE_COLUMN_FIELDS, TABLE_FIELD_LABEL, DETAIL_FIELDS, DETAIL_FIELD_LABEL, DEFAULT_OPEN_PROD_DETAIL_GROUPS, BUILTIN_ALWAYS_SHOWN_FIELDS, ATTACHMENTS_FIELD, ATTACHMENTS_FIELD_DEF, testPhaseFor, CREATE_REQUIRED_FIELDS } from './openProdDefectsFields';
import {
  hasHebrew, NameBadge, PersonAvatar, renderNotesField, DetailGroup,
  FieldChangeHistorySection, AttachmentsSection, parseNoteEntries, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow,
  IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, SEVERITY_COLOR, SelectColumnsDialog, SavedFilterState, splitTeams, PERSON_FIELDS } from '../shared/defectFieldDisplay';
import { formatDate, formatDateTime } from '../../utils/dateFormat';
import { cn } from '../../lib/utils';
import { CreateDefectScreen } from './CreateDefectScreen';
import { useDialog } from '../../context/DialogContext';
import { useAutoFitTable, WRAP_CLAMP_STYLE } from '../shared/useAutoFitTable';
import { DialogBrandBar, DIALOG_OVERLAY_BG, DIALOG_PANEL_SHADOW } from '../ui/BrandedDialog';
import { decodeNoteEntities } from '../shared/noteEntries';
import { usePermissions } from '../../context/PermissionsContext';
import { useLeaveGuard, useUnsavedChanges } from '../../context/UnsavedChangesContext';
import { BrandedDialog, DialogButton } from '../ui/BrandedDialog';

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
const PERSON_BADGE_FIELDS: Set<string> = PERSON_FIELDS;
const TEAM_BADGE_FIELDS = new Set(['responsibility']);

// title/description/notes always render in their own fixed spots (the big
// title line and the side-by-side text boxes) — never offered in the
// category picker.
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
  // broken / double-encoded entities ("&nbsp>", "&amp;nbsp;") first — see decodeNoteEntities
  let t = decodeNoteEntities(raw)
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
// Display-only marker for an empty field (user choice 2026-10-04) - never sent to QC.
const NOT_SET = <span className="italic font-normal" style={{ color: JIRA.textSubtle, opacity: 0.7 }}>Not set</span>;

function renderFieldValue(key: string, value: unknown) {
  const s = value === null || value === undefined ? '' : String(value);
  if (!s) return NOT_SET;
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s.replace(/\s*\([^()]*\)\s*$/, '') || s} />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'id') return <IssueKeyLink id={s} />;
  if (key === 'status') return <StatusBadge status={s} />;
  if (key === 'severity') return <SeverityBadge severity={s} />;
  if (key === 'priority' || key === 'secondaryPriority') return <PriorityCell value={s} />;
  if (DATE_ONLY_FIELDS.has(key)) return formatDate(s);
  if (DATETIME_FIELDS.has(key)) return formatDateTime(s);
  return s;
}

// Value box of the defect view form - same look as the create form's inputs.
// Inline on purpose: a stylesheet reset zeroes Tailwind's `border` here.
const VALUE_BOX_STYLE: React.CSSProperties = { border: `1px solid ${JIRA.greyN40}`, background: '#fff', borderRadius: 3 };
const DETAIL_TOP_BTN_CLASS = 'px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer text-[13px]';

// Common BG_STATUS values in this QC instance — a `datalist` (not a hard
// `<select>`) so a real status the list doesn't yet know still typeable.
const QC_STATUS_OPTIONS = ['New', 'Open', 'At Work', 'Fixed_Dev', 'Fixed_Test', 'Pending', 'Reopen', 'Rejected', 'Closed', 'Canceled'];


// Real closed value-lists confirmed from live Oracle reads (SEVERITY_COLOR /
// PriorityCell already used app-wide for these exact same values — see
// shared/defectFieldDisplay.tsx) — 2026-09-18 fix: these two fields were
// plain free-text inputs below even though QC itself only accepts one of a
// fixed set. Assigned To / Sub Module / Main Module have no confirmed real
// value list yet (project tree / dynamic user list) — stay free text until
// Tuesday's QC metadata probe.
const FREE_ENTRY_LIST_FIELDS = new Set(['detectedApkVersion', 'detectedHotAppApk', 'targetHotAppApk']);

// Fields that don't change after the defect was opened (user, 2026-10-07)
// Detected By / on Date are editable for ADMIN + RELEASE_MANAGER only — the
// server leaves them out of the editable list for everyone else (2026-10-08).
const LOCKED_DETAIL_FIELDS = new Set(['id', 'reporter', 'modified']);

const TIER2_FIELD_OPTIONS: Record<string, string[]> = {
  severity: ['Show Stopper', 'Severe', 'Medium', 'Low'],
  priority: ['High', 'Medium', 'Low'],
};


// ── Field editing (user, 2026-10-07 / 2026-10-08) ─────────────────────────
// Opens in a floating panel UNDER the field — the field keeps its size and
// nothing around it moves. Every list-like field (value lists, people,
// status, release/cycle) uses PickList: it opens on the WHOLE list, typing
// filters, ↑/↓ + Enter or a click picks; the current value carries a ✓.

type PickOption = {
  value: string; label: string; hint?: string;
  /** person name → avatar in the row */
  person?: string;
  /** section heading shown above the first option of each group */
  group?: string;
};

const PickList: React.FC<{
  options: PickOption[]; current: string; onPick: (v: string) => void; onCancel: () => void;
  allowCustom?: boolean; placeholder?: string;
}> = ({ options, current, onPick, onCancel, allowCustom, placeholder }) => {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);   // no page jump
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter(o => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t) || (o.hint ?? '').toLowerCase().includes(t)) : options;
  }, [q, options]);
  const shown = filtered.slice(0, 400);
  const isCurrent = (o: PickOption) => o.value === current || (!!current && o.label === current);
  useEffect(() => { setHi(0); }, [q]);
  // open on the current value (highlighted + scrolled into the list's view)
  useEffect(() => {
    const i = shown.findIndex(isCurrent);
    if (i > 0) setHi(i);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // keep the highlighted row visible by scrolling the LIST only — scrollIntoView
  // also scrolled the page, which made the whole form jump
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${hi}"]`);
    if (!box || !el) return;
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
  }, [hi]);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-subtle-foreground">🔍</span>
        <input
          ref={inputRef} value={q} onChange={e => setQ(e.target.value)} dir="auto"
          placeholder={placeholder ?? `חיפוש מתוך ${options.length}…`}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) onPick(shown[hi].value); else if (allowCustom && q.trim()) onPick(q.trim()); }
            else if (e.key === 'Escape') onCancel();
          }}
          className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-2.5 text-[13px] text-foreground outline-none focus:border-primary"
        />
      </div>
      <div ref={listRef} className="relative max-h-72 overflow-y-auto" dir="ltr">
        {shown.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-subtle-foreground">
            {allowCustom && q.trim() ? <>Enter — להשתמש ב-"{q.trim()}"</> : 'אין התאמות'}
          </div>
        )}
        {shown.map((o, i) => (
          <React.Fragment key={`${o.value}|${i}`}>
            {o.group && o.group !== shown[i - 1]?.group && (
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-subtle-foreground" dir="rtl">{o.group}</div>
            )}
            <div
              data-i={i}
              onMouseDown={e => { e.preventDefault(); onPick(o.value); }}
              onMouseEnter={() => setHi(i)}
              title={o.label}
              className={cn('flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-[13px]', i === hi && 'bg-muted', isCurrent(o) && 'font-semibold')}
              style={{ color: JIRA.text }}
            >
              <span className="w-3.5 shrink-0 text-center text-primary">{isCurrent(o) ? '✓' : ''}</span>
              {o.person && <Avatar name={o.person} size={22} />}
              <span className="min-w-0 flex-1 truncate" dir="auto">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[11px] font-normal text-subtle-foreground">{o.hint}</span>}
            </div>
          </React.Fragment>
        ))}
        {filtered.length > shown.length && (
          <div className="px-2.5 py-1.5 text-[11px] text-subtle-foreground">מוצגים {shown.length} מתוך {filtered.length} — הקלד כדי לצמצם</div>
        )}
      </div>
    </div>
  );
};

// Floating panel under a field (or above it when there's no room), drawn in
// a portal on <body> so no card / panel edge can clip it — z above the
// full-screen defect overlay (z-1001). At least as wide as the field; long
// value lists (CR/HBR reference, …) ask for more. Closes on an outside click
// (= cancel); follows the field when the page scrolls.
const EditPopover: React.FC<{
  onClose: () => void; title?: string; subtitle?: string; width?: number; children: React.ReactNode;
  /** a click outside the panel — defaults to onClose (cancel); text editors keep what was typed */
  onOutside?: () => void;
}> = ({ onClose, onOutside, title, subtitle, width = 320, children }) => {
  const markRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; w: number } | null>(null);
  const place = useCallback(() => {
    const anchor = markRef.current?.parentElement;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(window.innerWidth - 16, Math.max(r.width, width));
    const h = panelRef.current?.offsetHeight || 360;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const up = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h > 8;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, up, w });
  }, [width]);
  React.useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || markRef.current?.parentElement?.contains(t)) return;
      (onOutside ?? onClose)();
    };
    document.addEventListener('mousedown', onDown);
    // focus the editor without scrolling the page
    panelRef.current?.querySelector<HTMLElement>('input,textarea,select')?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose, onOutside, place]);
  return (
    <>
      <span ref={markRef} style={{ display: 'none' }} />
      {ReactDOM.createPortal(
        <div ref={panelRef} data-edit-popover="" dir="rtl" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
          className="fixed z-[5000] flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xl"
          style={pos
            ? { left: pos.left, width: pos.w, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }
            : { left: -9999, top: 0, width }}>
          {title && (
            <div className="flex items-center justify-between gap-2" dir="ltr">
              <span className="truncate text-xs font-bold tracking-wide" style={{ color: JIRA.textSubtle }}>{title}</span>
              <button type="button" onClick={onClose} title="סגור (Esc)"
                className="cursor-pointer border-none bg-transparent p-0 text-sm leading-none text-subtle-foreground hover:text-foreground">✕</button>
            </div>
          )}
          {subtitle && <div className="-mt-1 text-[11px] text-subtle-foreground">{subtitle}</div>}
          {children}
        </div>,
        document.body,
      )}
    </>
  );
};

const POPOVER_BTN = 'cursor-pointer rounded-md px-3 py-1 text-xs';

// Release-scoped list (user, 2026-10-09): CR/HBR Number reference = the CRs
// of the defect's Detected in Release + Regression / Production / Environment
// issue; Project = the systems of that release's CRs in DeployCenter. "הצג את
// כל הרשימה" opens the whole QC list (search works on whatever is shown).
export interface ScopedOptions { scoped: string[]; fixed: string[]; all: string[]; note?: string }
const ScopedListPicker: React.FC<{
  scopeTitle: string; load: () => Promise<ScopedOptions>;
  current: string; onPick: (v: string) => void; onCancel: () => void;
}> = ({ scopeTitle, load, current, onPick, onCancel }) => {
  const [data, setData] = useState<ScopedOptions | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { load().then(setData).catch(() => setFailed(true)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (failed) return <div className="p-1 text-xs text-danger">טעינת הרשימה נכשלה</div>;
  if (!data) return <div className="p-1 text-xs text-subtle-foreground">טוען…</div>;
  const nothingScoped = data.scoped.length === 0;
  const all = showAll || nothingScoped;
  const withCur = (opts: PickOption[]) => (current && !opts.some(o => o.value === current) ? [{ value: current, label: current, hint: 'נוכחי' }, ...opts] : opts);
  const options: PickOption[] = all
    ? withCur(data.all.map(v => ({ value: v, label: v })))
    : withCur([
      ...data.scoped.map(v => ({ value: v, label: v, group: scopeTitle })),
      ...data.fixed.map(v => ({ value: v, label: v, group: 'ערכים קבועים' })),
    ]);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-foreground">
        <input type="checkbox" checked={all} disabled={nothingScoped} onChange={e => setShowAll(e.target.checked)} />
        הצג את כל הרשימה ({data.all.length})
      </label>
      {nothingScoped && (
        <div className="text-[11px] text-subtle-foreground">
          {scopeTitle ? `לא נמצאו ${scopeTitle} — מוצגת כל הרשימה` : 'לא נבחרו גרסה או CR — מוצגת כל הרשימה'}
        </div>
      )}
      {!all && data.note && <div className="text-[11px] text-subtle-foreground">{data.note}</div>}
      <PickList key={all ? 'all' : 'scoped'} current={current} onPick={onPick} onCancel={onCancel}
        placeholder={all ? `חיפוש בכל ${data.all.length} הערכים…` : 'חיפוש…'}
        options={[{ value: '', label: '— ללא —' }, ...options]} />
    </div>
  );
};

// People picker (user, 2026-10-09): the whole directory, or — with "קבץ לפי
// צוות" ticked (remembered in this browser) — the teams first, and a team's
// members only after clicking it.
export type PersonTeam = { id: string; name: string; logins: string[] };
const GROUP_BY_TEAM_KEY = 'dc_person_picker_by_team';

const PersonPicker: React.FC<{
  people: PickOption[]; teams: PersonTeam[]; current: string;
  onPick: (v: string) => void; onCancel: () => void;
}> = ({ people, teams, current, onPick, onCancel }) => {
  const [byTeam, setByTeam] = useState<boolean>(() => {
    try { return localStorage.getItem(GROUP_BY_TEAM_KEY) === '1'; } catch { return false; }
  });
  const [team, setTeam] = useState<PersonTeam | 'none' | null>(null);
  const toggle = (on: boolean) => {
    setByTeam(on); setTeam(null);
    try { localStorage.setItem(GROUP_BY_TEAM_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const loginOf = (o: PickOption) => (o.hint ?? '').toLowerCase();
  const inAnyTeam = useMemo(() => new Set(teams.flatMap(t => t.logins)), [teams]);
  const noTeam = people.filter(o => o.hint && !inAnyTeam.has(loginOf(o)));

  const header = (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-foreground">
      <input type="checkbox" checked={byTeam} onChange={e => toggle(e.target.checked)} />
      קבץ לפי צוות
    </label>
  );

  if (!byTeam) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <PickList current={current} onPick={onPick} onCancel={onCancel} placeholder="חפש שם או משתמש…" options={people} />
      </div>
    );
  }
  if (!team) {
    const teamOpts: PickOption[] = [
      ...teams.map(t => ({ value: t.id, label: t.name, hint: `${people.filter(o => t.logins.includes(loginOf(o))).length} עובדים` })),
      ...(noTeam.length ? [{ value: '__none__', label: 'ללא שיוך לצוות', hint: `${noTeam.length} עובדים` }] : []),
    ];
    return (
      <div className="flex flex-col gap-2">
        {header}
        <PickList key="teams" current="" onCancel={onCancel} placeholder="חפש צוות…" options={teamOpts}
          onPick={id => setTeam(id === '__none__' ? 'none' : (teams.find(t => t.id === id) ?? null))} />
      </div>
    );
  }
  const members = team === 'none' ? noTeam : people.filter(o => team.logins.includes(loginOf(o)));
  return (
    <div className="flex flex-col gap-2">
      {header}
      <div className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px]" style={{ background: JIRA.greyN20 }}>
        <span className="truncate"><span style={{ color: JIRA.textSubtle }}>צוות: </span><b style={{ color: JIRA.text }} dir="auto">{team === 'none' ? 'ללא שיוך לצוות' : team.name}</b></span>
        <button type="button" onClick={() => setTeam(null)} className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">← כל הצוותים</button>
      </div>
      <PickList key={team === 'none' ? 'none' : team.id} current={current} onPick={onPick} onCancel={onCancel}
        placeholder="חפש בצוות…" options={[{ value: '', label: '— ללא —' }, ...members]} />
    </div>
  );
};

const InlineFieldEditor: React.FC<{
  fieldKey: string; initialValue: string; currentStatus: string; allowedTransitions: string[] | null;
  dynamicOptions?: string[]; onCommit: (value: string) => void; onCancel: () => void;
  personOptions?: { login: string; fullName: string }[];
  /** list / person / date / number / text / memo — from the production QC field dump */
  fieldKind?: string;
  /** set while a text-like editor is open: a click outside keeps what was typed (user, 2026-10-09) */
  outsideCommitRef?: React.MutableRefObject<(() => void) | null>;
  /** teams + their members' QC logins, for the people picker's "group by team" */
  personTeams?: PersonTeam[];
}> = ({ fieldKey, initialValue, currentStatus, allowedTransitions, dynamicOptions, onCommit, onCancel, personOptions, fieldKind, outsideCommitRef, personTeams }) => {
  const [value, setValue] = useState(initialValue);
  const isPickList = fieldKey === 'status' || PERSON_FIELDS.has(fieldKey) || fieldKind === 'person'
    || (fieldKind !== 'date' && fieldKind !== 'number' && fieldKind !== 'memo' && (!!(dynamicOptions && dynamicOptions.length) || !!TIER2_FIELD_OPTIONS[fieldKey]));
  useEffect(() => {
    if (!outsideCommitRef) return;
    outsideCommitRef.current = isPickList ? null : () => onCommit(value);
    return () => { outsideCommitRef.current = null; };
  });
  const fieldClass = 'w-full box-border px-2.5 py-1.5 rounded-md border border-border text-[13px] bg-card text-foreground outline-none focus:border-primary';
  const withCurrent = (opts: PickOption[]) => (initialValue && !opts.some(o => o.value === initialValue || o.label === initialValue)
    ? [{ value: initialValue, label: initialValue, hint: 'נוכחי' }, ...opts] : opts);
  const buttons = (
    <div className="flex justify-end gap-1.5">
      <button type="button" onClick={onCancel} className={`${POPOVER_BTN} border border-border bg-card`}>ביטול</button>
      <button type="button" onClick={() => onCommit(value)} className={`${POPOVER_BTN} border-none bg-primary font-semibold text-white`}>אישור</button>
    </div>
  );

  if (fieldKey === 'status') {
    if (!allowedTransitions) return <div className="p-1 text-xs text-subtle-foreground">אין מעברי סטטוס זמינים</div>;
    if (allowedTransitions.length === 0) return <div className="p-1 text-xs text-subtle-foreground">אין מעבר אפשרי מ-"{currentStatus}" לפי מחזור החיים</div>;
    return (
      <PickList current={currentStatus} onPick={onCommit} onCancel={onCancel} placeholder="בחר סטטוס…"
        options={[{ value: currentStatus, label: currentStatus, hint: 'נוכחי' }, ...allowedTransitions.map(s => ({ value: s, label: s }))]} />
    );
  }

  // people: the whole directory with avatars, "Full Name (login)" as the
  // value — the server writes only the login to QC (QcRestService.toQcLogin)
  if (PERSON_FIELDS.has(fieldKey) || fieldKind === 'person') {
    const people = (personOptions ?? []).map(p => ({ value: `${p.fullName} (${p.login})`, label: p.fullName, hint: p.login, person: p.fullName }));
    return <PersonPicker current={initialValue} onPick={onCommit} onCancel={onCancel} teams={personTeams ?? []}
      people={[{ value: '', label: '— ללא —' }, ...withCurrent(people)]} />;
  }

  if (fieldKind === 'date') {
    const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(value);
    const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : value.slice(0, 10);
    return (
      <div className="flex flex-col gap-2">
        <input type="date" value={iso} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCommit(value); if (e.key === 'Escape') onCancel(); }}
          className={fieldClass} dir="ltr" />
        {buttons}
      </div>
    );
  }
  if (fieldKind === 'number' || fieldKind === 'memo' || (!(dynamicOptions && dynamicOptions.length) && !TIER2_FIELD_OPTIONS[fieldKey])) {
    const isMemo = fieldKind === 'memo';
    return (
      <div className="flex flex-col gap-2">
        {isMemo
          ? <textarea value={value} rows={5} dir="auto" onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} className={`${fieldClass} resize-y`} />
          : <input type={fieldKind === 'number' ? 'number' : 'text'} step="any" value={value} dir="auto"
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onCommit(value); if (e.key === 'Escape') onCancel(); }} className={fieldClass} />}
        {buttons}
      </div>
    );
  }

  // value lists — QC's own list first (Priority there also has "Test Blocker");
  // the hardcoded Severity/Priority values are only a fallback while no list is cached
  const opts = ((dynamicOptions && dynamicOptions.length ? dynamicOptions : TIER2_FIELD_OPTIONS[fieldKey]) ?? []).map(o => ({ value: o, label: o }));
  return <PickList current={initialValue} onPick={onCommit} onCancel={onCancel}
    allowCustom={FREE_ENTRY_LIST_FIELDS.has(fieldKey)}
    options={[{ value: '', label: '— ללא —' }, ...withCurrent(opts)]} />;
};

// Release + cycle are pairs (user, 2026-10-08): pick the release, then one of
// ITS cycles — a cycle of another release can't be chosen (the server checks
// it again before writing). Names on screen, ids to QC. Releases a DeployCenter
// version is running come first, then every QC release.
export type ReleaseCycleOptionT = { id: string; name: string; startDate: string | null; inFlight: boolean; cycles: { id: string; name: string; startDate: string | null }[] };
export type RefValue = { id: string; label: string };

const ReleaseCycleEditor: React.FC<{
  releases: ReleaseCycleOptionT[] | null; startOnCycle: boolean;
  currentRelease: string; currentCycle: string;
  onCommit: (release: RefValue, cycle: RefValue) => void; onCancel: () => void;
  /** Target Release (user, 2026-10-09): only releases that start after this one
   *  (the defect's Detected in Release); none known = from today on */
  laterThan?: { name: string | null; startDate: string | null };
}> = ({ releases: allReleases, startOnCycle, currentRelease, currentCycle, onCommit, onCancel, laterThan }) => {
  const floor = laterThan ? (laterThan.startDate ?? new Date().toISOString().slice(0, 10)) : null;
  const releases = allReleases && floor
    ? allReleases.filter(r => r.name === currentRelease || (!!r.startDate && r.startDate > floor))
    : allReleases;
  const matched = releases?.find(r => r.name === currentRelease) ?? null;
  const [rel, setRel] = useState<ReleaseCycleOptionT | null>(startOnCycle ? matched : null);
  if (!releases) return <div className="p-1 text-xs text-subtle-foreground">טוען גרסאות…</div>;
  if (releases.length === 0) return <div className="p-1 text-xs text-subtle-foreground">לא נמצאו גרסאות ב-QC</div>;

  if (!rel) {
    const opts: PickOption[] = [...releases].sort((a, b) => Number(b.inFlight) - Number(a.inFlight)).map(r => ({
      value: r.id, label: r.name,
      hint: r.cycles.length ? `${r.cycles.length} סבבים` : 'ללא סבבים',
      group: r.inFlight ? 'גרסאות פעילות' : 'כל הגרסאות ב-QC',
    }));
    return (
      <div className="flex flex-col gap-2">
        <StepHeader step={1} text={laterThan
          ? (laterThan.name ? `בחר גרסה — מוצגות גרסאות מאוחרות מ-${laterThan.name}` : 'בחר גרסה — מוצגות גרסאות מהיום והלאה')
          : 'בחר גרסה'} />
        <PickList options={opts} current={matched?.id ?? ''} onCancel={onCancel} placeholder="חפש גרסה…"
          onPick={id => {
            const r = releases.find(x => x.id === id);
            if (!r) return;
            if (r.cycles.length === 0) onCommit({ id: r.id, label: r.name }, { id: '', label: '' });
            else setRel(r);
          }} />
      </div>
    );
  }

  const cycleOpts: PickOption[] = [
    { value: '', label: '— ללא סבב —' },
    ...rel.cycles.map(c => ({ value: c.id, label: c.name, hint: c.startDate ? formatDate(c.startDate) : undefined })),
  ];
  const curCycle = rel.name === currentRelease ? (rel.cycles.find(c => c.name === currentCycle)?.id ?? '') : '\u0000';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px]" style={{ background: JIRA.greyN20 }}>
        <span className="truncate" dir="rtl"><span style={{ color: JIRA.textSubtle }}>גרסה: </span><b dir="ltr" style={{ color: JIRA.text }}>{rel.name}</b></span>
        <button type="button" onClick={() => setRel(null)} className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">החלף גרסה</button>
      </div>
      <StepHeader step={2} text={`בחר סבב של ${rel.name}`} />
      <PickList options={cycleOpts} current={curCycle} onCancel={onCancel} placeholder="חפש סבב…"
        onPick={id => {
          const c = rel.cycles.find(x => x.id === id);
          onCommit({ id: rel.id, label: rel.name }, { id: c?.id ?? '', label: c?.name ?? '' });
        }} />
    </div>
  );
};

const StepHeader: React.FC<{ step: number; text: string }> = ({ step, text }) => (
  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-white">{step}</span>
    {text}
  </div>
);

// release ↔ cycle pairs of the defect form
const REF_PAIR_OF: Record<string, [string, string]> = {
  detectedInRelease: ['detectedInRelease', 'detectedInCycle'], detectedInCycle: ['detectedInRelease', 'detectedInCycle'],
  targetRelease: ['targetRelease', 'targetCycle'], targetCycle: ['targetRelease', 'targetCycle'],
};

// Team (Responsibility) ↔ Environment Component: the team's own components,
// or every value when the team has none defined (user, 2026-10-08).
export type TeamEnvComponents = { teams: { name: string; responsibility: string | null; components: string[] }[]; all: string[] };
function teamComponentsFor(data: TeamEnvComponents | null, team: string): string[] {
  const t = team.trim().toLowerCase();
  if (!data || !t) return [];
  const hit = data.teams.find(x => (x.responsibility ?? '').toLowerCase() === t) ?? data.teams.find(x => x.name.toLowerCase() === t);
  return hit?.components ?? [];
}


// ── One field of a defect form (2026-10-09) ────────────────────────────────
// Shared by the edit form (DefectDetailScreen) and the create form
// (CreateDefectScreen): label, value box, editable/locked marking, required
// "*", and the floating editor. Each form supplies its values and rules in ctx.
export interface DefectFieldsCtx {
  valueOf: (key: string) => string;
  isDirty: (key: string) => boolean;
  isEditable: (key: string) => boolean;
  lockReason: (key: string) => string | undefined;
  /** create form: fields QC requires (marked *) and, after a failed submit, the missing ones (red) */
  required?: Set<string>;
  missing?: Set<string>;
  editingField: string | null;
  setEditingField: (key: string | null) => void;
  commitField: (key: string, value: string) => void;
  commitPair: (relKey: string, cycKey: string, rel: RefValue, cyc: RefValue) => void;
  outsideCommit: React.MutableRefObject<(() => void) | null>;
  teamEnv: TeamEnvComponents | null;
  fieldPicklists: Record<string, string[]>;
  fieldKinds: Record<string, string>;
  personDirectory: { login: string; fullName: string }[];
  personTeams: PersonTeam[];
  releaseOptions: ReleaseCycleOptionT[] | null;
  currentStatus: string;
  allowedTransitions: string[] | null;
  /** CR/HBR reference + Project: options scoped to the defect's Detected in Release */
  loadScoped?: (key: string, release: string, cr: string) => Promise<ScopedOptions>;
}

// fields whose list is scoped to the defect's release (2026-10-09)
const RELEASE_SCOPED_FIELDS: Record<string, true> = { crHbrNumberReference: true, system: true };
// "12714 - name" → "12714"
export const crNumberOf = (v: string) => /^\s*(\d{3,})/.exec(v ?? '')?.[1] ?? '';
const scopeTitleOf = (key: string, release: string, cr: string) => {
  if (key === 'crHbrNumberReference') return release ? `ה-CR-ים של ${release}` : '';
  const n = crNumberOf(cr);
  return n ? `הפרויקט של CR ${n}` : release ? `הפרויקטים של ${release}` : '';
};

export const DefectFieldCell: React.FC<{ fieldKey: string; wide: boolean; ctx: DefectFieldsCtx }> = ({ fieldKey: key, wide: isWide, ctx }) => {
                      const isDirty = ctx.isDirty(key);
                      const displayValue = ctx.valueOf(key);
                      const isAtomic = PERSON_BADGE_FIELDS.has(key) || TEAM_BADGE_FIELDS.has(key)
                        || key === 'id' || key === 'status' || key === 'severity' || key === 'priority' || key === 'secondaryPriority';
                      const valRtl = !isAtomic && !!displayValue && hasHebrew(displayValue);
                      const isEditable = ctx.isEditable(key);
                      const lockReason = ctx.lockReason(key);
                      const isEditingThis = ctx.editingField === key;
                      const isRequired = !!ctx.required?.has(key);
                      const isMissing = !!ctx.missing?.has(key);
                      const label = DETAIL_FIELD_LABEL[key] ?? key;
                      // Environment Component follows the (possibly just changed) team
                      const team = ctx.valueOf('responsibility');
                      const teamComps = key === 'environmentComponent' ? teamComponentsFor(ctx.teamEnv, team) : [];
                      const envMismatch = key === 'environmentComponent' && teamComps.length > 0 && !!displayValue && !teamComps.includes(displayValue);
                      const listOptions = key === 'environmentComponent'
                        ? (teamComps.length ? teamComps : (ctx.teamEnv?.all ?? []))
                        : ctx.fieldPicklists[key];
                      const pair = REF_PAIR_OF[key];
                      // popover width: release/cycle and people a bit wider, long value lists (CR/HBR reference…) wide
                      const popWidth = pair ? 380
                        : (PERSON_FIELDS.has(key) || ctx.fieldKinds[key] === 'person') ? 340
                        : (listOptions ?? []).some(o => o.length > 30) ? 520 : 320;
                      const plainValue = PERSON_BADGE_FIELDS.has(key) ? displayValue.replace(/\s*\([^()]*\)\s*$/, '') : displayValue;
                      return (
                        <div
                          
                          onClick={() => { if (isEditable && !isEditingThis) ctx.setEditingField(key); }}
                          title={isEditable && !isEditingThis ? 'לחץ לעריכה' : lockReason}
                          // Editable = a light blue wash + ✏️ on hover (user, 2026-10-09:
                          // the dashed frame on every field was noise); locked = 🔒 by
                          // the label; editing = solid blue frame; unsaved = yellow.
                          className={cn('group relative flex min-w-0 flex-col gap-1 rounded-md px-1.5 py-1 transition-colors',
                            isEditable && !isEditingThis && !isDirty && 'hover:bg-[#eef4ff]')}
                          style={{
                            gridColumn: isWide ? '1 / -1' : undefined,
                            border: isEditingThis ? `1px solid ${JIRA.blue}` : isMissing ? '1px solid #DE350B' : '1px solid transparent',
                            cursor: isEditable && !isEditingThis ? 'pointer' : undefined,
                            background: isDirty ? '#fffbe6' : undefined,
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-1 text-xs font-bold tracking-wide" style={{ color: JIRA.textSubtle, direction: 'ltr' }}>
                            <span className="truncate" title={label}>{label}</span>
                            {isRequired && <span className="shrink-0" style={{ color: '#DE350B' }} title="שדה חובה ב-QC">*</span>}
                            {!isEditable && <span className="shrink-0 text-[10px] opacity-60" title={lockReason ?? 'שדה לקריאה בלבד'}>🔒</span>}
                            {isEditable && !isEditingThis && <span className="pointer-events-none absolute right-1.5 top-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>✏️</span>}
                          </span>
                          {/* same height in every box; one line unless the field is wide.
                              Stays in place while editing — the editor floats under it. */}
                          <span
                            className={cn('flex min-h-[32px] w-full min-w-0 items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium',
                              isWide ? 'flex-wrap break-words' : 'overflow-hidden whitespace-nowrap')}
                            title={plainValue || undefined}
                            style={{ color: JIRA.text, direction: valRtl ? 'rtl' : 'ltr', ...VALUE_BOX_STYLE }}
                          >
                            {isDirty && <span title="שינוי לא שמור" className="shrink-0" style={{ color: JIRA.blue }}>●</span>}
                            {envMismatch && <span className="shrink-0" title={`לא שייך לרכיבי הצוות ${team}`}>⚠</span>}
                            <span className={isWide ? 'min-w-0' : 'min-w-0 truncate'}>{renderFieldValue(key, displayValue)}</span>
                          </span>
                          {isEditingThis && (
                            <EditPopover onClose={() => ctx.setEditingField(null)} width={popWidth}
                              onOutside={() => { if (ctx.outsideCommit.current) ctx.outsideCommit.current(); else ctx.setEditingField(null); }}
                              title={label}
                              subtitle={key === 'environmentComponent'
                                ? (teamComps.length ? `רכיבי הצוות ${team}` : team ? `לצוות ${team} לא הוגדרו רכיבים — מוצגים כל הערכים` : undefined)
                                : undefined}>
                              {RELEASE_SCOPED_FIELDS[key] && ctx.loadScoped ? (
                                <ScopedListPicker
                                  scopeTitle={scopeTitleOf(key, ctx.valueOf('detectedInRelease'), ctx.valueOf('crHbrNumberReference'))}
                                  load={() => ctx.loadScoped!(key, ctx.valueOf('detectedInRelease'), ctx.valueOf('crHbrNumberReference'))}
                                  current={displayValue}
                                  onPick={v => ctx.commitField(key, v)}
                                  onCancel={() => ctx.setEditingField(null)}
                                />
                              ) : pair ? (
                                <ReleaseCycleEditor
                                  releases={ctx.releaseOptions}
                                  startOnCycle={key === pair[1]}
                                  laterThan={pair[0] === 'targetRelease' ? (() => {
                                    const detName = ctx.valueOf('detectedInRelease');
                                    const det = (ctx.releaseOptions ?? []).find(r => r.name === detName);
                                    return { name: det ? det.name : null, startDate: det?.startDate ?? null };
                                  })() : undefined}
                                  currentRelease={ctx.valueOf(pair[0])}
                                  currentCycle={ctx.valueOf(pair[1])}
                                  onCommit={(rel, cyc) => ctx.commitPair(pair[0], pair[1], rel, cyc)}
                                  onCancel={() => ctx.setEditingField(null)}
                                />
                              ) : (
                                <InlineFieldEditor
                                  fieldKey={key}
                                  initialValue={displayValue}
                                  currentStatus={ctx.currentStatus}
                                  allowedTransitions={ctx.allowedTransitions}
                                  dynamicOptions={listOptions}
                                  personOptions={ctx.personDirectory}
                                  personTeams={ctx.personTeams}
                                  fieldKind={key === 'environmentComponent' ? 'list' : ctx.fieldKinds[key]}
                                  outsideCommitRef={ctx.outsideCommit}
                                  onCommit={v => ctx.commitField(key, v)}
                                  onCancel={() => ctx.setEditingField(null)}
                                />
                              )}
                            </EditPopover>
                          )}
                        </div>
                      );
};

// CR/HBR reference → the release's CRs + fixed values; Project → the
// release's systems in DeployCenter (both forms)
export async function loadReleaseScopedOptions(headers: Record<string, string>, key: string, release: string, cr = ''): Promise<ScopedOptions> {
  if (key === 'crHbrNumberReference') {
    const d = (await axios.get(`${API}/qc/cr-reference-options`, { headers, params: { release } })).data;
    return { scoped: d?.versionCrs ?? [], fixed: d?.fixed ?? [], all: d?.all ?? [] };
  }
  const d = (await axios.get(`${API}/qc/project-options`, { headers, params: { release, cr: crNumberOf(cr) ? cr : undefined } })).data;
  // the CRs' business projects (CR list "פרויקט" column) — never QC's systems list
  return { scoped: d?.crProject ? [d.crProject] : (d?.versionProjects ?? []), fixed: [], all: d?.all ?? [] };
}

// Picking a CR fills Project with that CR's project from the CR list (user, 2026-10-09)
export async function singleProjectForCr(headers: Record<string, string>, release: string, cr: string): Promise<string | null> {
  if (!crNumberOf(cr)) return null;
  const d = (await axios.get(`${API}/qc/project-options`, { headers, params: { release, cr } }).catch(() => ({ data: null }))).data;
  return d?.crProject ?? null;
}

// Unsaved defect-form changes kept in this browser (see DefectDetailScreen)
type DefectDraft = { pendingEdits: Record<string, string>; pendingRefEdits: Record<string, RefValue>; newComment: string | null; at: number };
type DefectChange = { key: string; label: string; mine: boolean; before: string; after: string; by?: string; at?: string };
function readDefectDraft(key: string): DefectDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? 'null');
    return d && typeof d === 'object' && draftChangeCount(d) > 0 ? d : null;
  } catch { return null; }
}
function draftChangeCount(d: DefectDraft): number {
  return Object.keys(d.pendingEdits ?? {}).length
    + new Set(Object.keys(d.pendingRefEdits ?? {}).map(k => REF_PAIR_OF[k]?.[0] ?? k)).size
    + (d.newComment?.trim() ? 1 : 0);
}

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
  const dialog = useDialog();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [detail, setDetail] = useState<DefectFullDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailReload, setDetailReload] = useState(0);   // bumped after a save → re-read from QC

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    axios.get(`${API}/qc/open-prod-defect-detail/${encodeURIComponent(defectId)}`, { headers })
      .then(r => { setDetail(r.data ?? null); baseDetailRef.current = r.data ?? null; })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defectId, token, detailReload]);
  // what the form showed when it was loaded — compared with QC again right
  // before saving, to catch someone else's change in between (2026-10-09)
  const baseDetailRef = useRef<DefectFullDetail | null>(null);

  const currentStatus = String(detail?.status ?? '');

  // Lifted 2026-09-19 from QcWriteBackPanel — the new inline sidebar editor
  // below needs the exact same write-permission probe and workflow-transition
  // list to gate its own "✏️ ערוך" button and status editor, so both surfaces
  // share one fetch each instead of two independent ones.
  // Status + comments are editable by PERMISSION (action:qc_write), not by the
  // live QC probe below (user, 2026-10-07: an admin in a mapped QA team got a
  // locked status because the probe failed). A failed probe is shown as a
  // notice instead — the save itself reports QC's real error.
  const { can } = usePermissions();
  const canQcWrite = can('action:qc_write');
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

  // Which business fields this app can actually write to a defect — fetched
  // from the backend's own TIER2_FIELD_PARAM_KEYS (single source of truth,
  // 2026-09-23 fixes-batch A.5) instead of a hardcoded frontend list, so
  // double-click editing automatically covers every field the backend
  // supports, including ones added later, without a matching frontend edit.
  // Not defect-specific — fetched once per token, not re-fetched per defect.
  const [editableFieldKeys, setEditableFieldKeys] = useState<Set<string>>(new Set());
  // Reference-type editable fields (Detected in Release/Cycle) — separate
  // set from editableFieldKeys because they need a real release/cycle
  // picker (RefFieldEditor below), not the plain text/select InlineFieldEditor
  // every other field uses (2026-09-23, fixes-batch A.5).
  const [refEditableFieldKeys, setRefEditableFieldKeys] = useState<Set<string>>(new Set());
  const [fieldKinds, setFieldKinds] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/qc/defect-editable-fields`, { headers })
      .then(r => {
        if (!alive) return;
        setEditableFieldKeys(new Set(['status', ...(r.data?.fields ?? [])]));
        setRefEditableFieldKeys(new Set(r.data?.refFields ?? []));
        setFieldKinds(r.data?.kinds ?? {});
      })
      .catch(() => { if (alive) setEditableFieldKeys(new Set(['status'])); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Real closed-value-lists for the fields QC actually backs with a List-Id
  // (fixes-batch A.6) — read from our own cache (QcPicklistCache), refreshed
  // separately by an admin action ("🔄 רענון מטמון רשימות ערכים" in the
  // "בדיקת כתיבה ל-QC" tab), never a live QC call from this screen itself.
  const [fieldPicklists, setFieldPicklists] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/qc/defect-field-picklists`, { headers })
      .then(r => {
        if (!alive) return;
        const out: Record<string, string[]> = {};
        for (const [key, entry] of Object.entries<any>(r.data ?? {})) if (entry?.values) out[key] = entry.values;
        setFieldPicklists(out);
      })
      .catch(() => {});
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // release -> cycles (paired pickers) and team -> environment components
  const [releaseOptions, setReleaseOptions] = useState<ReleaseCycleOptionT[] | null>(null);
  const [teamEnv, setTeamEnv] = useState<TeamEnvComponents | null>(null);
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/qc/release-cycle-options`, { headers }).then(r => { if (alive) setReleaseOptions(r.data ?? []); }).catch(() => { if (alive) setReleaseOptions([]); });
    axios.get(`${API}/qc/team-environment-components`, { headers }).then(r => { if (alive) setTeamEnv(r.data ?? null); }).catch(() => {});
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
  // the writable fields (editableFieldKeys, fetched above) into an editable state;
  // double-clicking one opens its own editor in place (select for a closed
  // value-list, text otherwise); one "💾 שמור" batches every pending field
  // into the minimum number of PATCH calls. The older "עדכון ישיר ל-QC" panel
  // below stays as a fallback (user's explicit call) rather than being removed.
  // One-button update (user, 2026-10-07): no "edit mode" any more — every
  // field the user may change is editable straight away (click it), changes
  // pile up, and ONE "עדכן תקלה" writes fields + status + new comment to QC
  // together. Status / comment need QC write access (`blocked`), the other
  // fields the field-edit permission (editableFieldKeys).
  const [personDirectory, setPersonDirectory] = useState<{ login: string; fullName: string }[]>([]);
  useEffect(() => {
    if (personDirectory.length > 0) return;
    axios.get(`${API}/qc/person-directory`, { headers }).then(r => setPersonDirectory(r.data ?? [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  // teams → members' QC logins, for "group by team" in the people pickers
  const [personTeams, setPersonTeams] = useState<PersonTeam[]>([]);
  useEffect(() => {
    axios.get(`${API}/qc/person-teams`, { headers }).then(r => setPersonTeams(r.data ?? [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  // a new comment in QC's own format (signature added by the server on save)
  const [newComment, setNewComment] = useState<string | null>(null);
  const [commentSignature, setCommentSignature] = useState('');
  const openNewComment = () => {
    setNewComment(prev => prev ?? '');
    if (!commentSignature) {
      axios.get(`${API}/qc/comment-signature`, { headers })
        .then(r => setCommentSignature(r.data?.signature ?? ''))
        .catch(err => setInlineMsg({ kind: 'err', text: err?.response?.data?.message || 'לא ניתן לזהות את משתמש ה-QC שלך' }));
    }
  };
  const [editingField, setEditingField] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  // Reference-field pending edits (Detected in Release/Cycle) — a real
  // {id,label} pair, not a plain string, so it's kept in its own map rather
  // than shoehorned into pendingEdits (2026-09-23, fixes-batch A.5).
  const [pendingRefEdits, setPendingRefEdits] = useState<Record<string, { id: string; label: string }>>({});
  const [savingInline, setSavingInline] = useState(false);
  const [inlineMsg, setInlineMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    // A freshly opened/changed defect starts clean — no stale edits carried
    // over from whatever was previously viewed.
    setEditingField(null); setPendingEdits({}); setPendingRefEdits({}); setInlineMsg(null); setNewComment(null);
  }, [defectId]);

  const cancelInlineEdit = async () => {
    if (pendingCount > 0 && !await dialog.confirm('לבטל את השינויים שלא נשמרו?', 'ביטול שינויים', 'warning')) return;
    setEditingField(null); setPendingEdits({}); setPendingRefEdits({}); setInlineMsg(null); setNewComment(null);
  };

  // Test Phase follows the cycle / production — only when the user changes
  // the cycle or the Environment; shown as a pending change (2026-10-09)
  const syncTestPhase = (cycle: string, environment: string) => {
    const tp = testPhaseFor(cycle, environment);
    if (!tp) return;
    setPendingEdits(prev => {
      const next = { ...prev };
      if (tp === String((detail as any)?.testPhase ?? '').trim()) delete next.testPhase; else next.testPhase = tp;
      return next;
    });
  };

  const commitInlineField = (key: string, value: string) => {
    if (key === 'environment') {
      syncTestPhase(pendingRefEdits.detectedInCycle?.label ?? String((detail as any)?.detectedInCycle ?? ''), value);
    }
    if (key === 'crHbrNumberReference' && value && !(pendingEdits.system ?? String((detail as any)?.system ?? '')).trim()) {
      const release = pendingRefEdits.detectedInRelease?.label ?? String((detail as any)?.detectedInRelease ?? '');
      singleProjectForCr(headers, release, value).then(p => { if (p) setPendingEdits(prev => (prev.system ? prev : { ...prev, system: p })); });
    }
    const original = String((detail as any)?.[key] ?? '');
    setPendingEdits(prev => {
      const next = { ...prev };
      if (value.trim() === original.trim()) delete next[key]; else next[key] = value;
      return next;
    });
    setEditingField(null);
  };

  // a release and its cycle are always sent together (the server checks the pair)
  const commitRefPair = (relKey: string, cycKey: string, rel: RefValue, cyc: RefValue) => {
    if (cycKey === 'detectedInCycle') syncTestPhase(cyc.label, pendingEdits.environment ?? String((detail as any)?.environment ?? ''));
    const same = (k: string, v: RefValue) => v.label.trim() === String((detail as any)?.[k] ?? '').trim();
    setPendingRefEdits(prev => {
      const next = { ...prev };
      if (same(relKey, rel) && same(cycKey, cyc)) { delete next[relKey]; delete next[cycKey]; }
      else { next[relKey] = rel; next[cycKey] = cyc; }
      return next;
    });
    setEditingField(null);
  };

  const [missingRequired, setMissingRequired] = useState<Set<string>>(new Set());
  const pendingCount = Object.keys(pendingEdits).length
    + new Set(Object.keys(pendingRefEdits).map(k => REF_PAIR_OF[k]?.[0] ?? k)).size
    + (newComment?.trim() ? 1 : 0);

  // ── Draft (user, 2026-10-09): every change is kept in this browser per
  // defect until it reaches QC, so a refresh, a closed tab or an expired
  // login doesn't lose it; reopening the defect offers to restore it.
  const draftKey = `dc_defect_draft_${defectId}`;
  const [draftOffer, setDraftOffer] = useState<DefectDraft | null>(null);
  const draftReady = useRef(false);   // false while a found draft waits for restore / discard
  useEffect(() => {
    const d = readDefectDraft(draftKey);
    draftReady.current = !d;
    setDraftOffer(d);
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady.current) return;
    try {
      if (pendingCount === 0 && !newComment) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ pendingEdits, pendingRefEdits, newComment, at: Date.now() }));
    } catch { /* storage unavailable — the leave guard still protects */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits, pendingRefEdits, newComment]);
  const restoreDraft = () => {
    if (!draftOffer) return;
    setPendingEdits(draftOffer.pendingEdits ?? {}); setPendingRefEdits(draftOffer.pendingRefEdits ?? {}); setNewComment(draftOffer.newComment ?? null);
    draftReady.current = true; setDraftOffer(null);
  };
  const dropDraft = () => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    draftReady.current = true; setDraftOffer(null);
  };

  // ── QC edit lock (user, 2026-10-09): someone standing on this defect in QC
  // locks it — shown when the form opens, re-checked every minute, and a save
  // QC refuses for it says who holds it (the changes stay).
  const [lock, setLock] = useState<{ locked: boolean; by?: string; byName?: string; since?: string; source?: string } | null>(null);
  const checkLock = useCallback(() => {
    axios.get(`${API}/qc/defects/${encodeURIComponent(defectId)}/lock`, { headers })
      .then(r => setLock(r.data ?? null))
      .catch(() => {});
  }, [defectId, headers]);
  useEffect(() => {
    setLock(null);
    checkLock();
    const t = window.setInterval(checkLock, 60_000);
    return () => window.clearInterval(t);
  }, [checkLock]);

  // An expired login: the changes stay (draft); "leave without saving" then keeps the draft too.
  const [sessionExpired, setSessionExpired] = useState(false);

  // ── Someone else changed the defect in QC since it was opened (2026-10-09)
  const [conflict, setConflict] = useState<{ fresh: DefectFullDetail; changes: DefectChange[] } | null>(null);
  const conflictResolve = useRef<((choice: 'overwrite' | 'review' | 'cancel') => void) | null>(null);
  const findConflicts = async (): Promise<{ fresh: DefectFullDetail; changes: DefectChange[] } | null> => {
    const base = baseDetailRef.current;
    if (!base) return null;
    const fresh: DefectFullDetail | null = (await axios.get(`${API}/qc/open-prod-defect-detail/${encodeURIComponent(defectId)}`, { headers })).data ?? null;
    if (!fresh) return null;
    const mine = new Set([...Object.keys(pendingEdits), ...Object.keys(pendingRefEdits)]);
    const changed = Object.keys({ ...base, ...fresh }).filter(k => k !== 'modified' && typeof (fresh as any)[k] !== 'object'
      && String((base as any)[k] ?? '').trim() !== String((fresh as any)[k] ?? '').trim());
    if (changed.length === 0) return null;
    // who / when, from QC's audit log (best effort)
    let history: { changeTime: string; changedBy: string; propertyName: string }[] = [];
    try { history = (await axios.get(`${API}/qc/defect-field-history`, { headers, params: { defectId } })).data ?? []; } catch { /* no history */ }
    const changes = changed.map(k => {
      const label = DETAIL_FIELD_LABEL[k] ?? k;
      const h = history.filter(x => x.propertyName?.toLowerCase() === label.toLowerCase())
        .sort((a, b) => String(b.changeTime).localeCompare(String(a.changeTime)))[0];
      return {
        key: k, label, mine: mine.has(k),
        before: String((base as any)[k] ?? ''), after: String((fresh as any)[k] ?? ''),
        by: h?.changedBy, at: h?.changeTime,
      };
    }).sort((a, b) => Number(b.mine) - Number(a.mine));
    return { fresh, changes };
  };

  const saveInlineEdits = async (): Promise<boolean> => {
    if (pendingCount === 0) return true;
    // a QC-required field that had a value must not be emptied (2026-10-09);
    // one that was already empty (old defects) never blocks other changes
    const emptied = Array.from(CREATE_REQUIRED_FIELDS).filter(k => {
      const before = String((detail as any)?.[k] ?? '').trim();
      const after = refEditableFieldKeys.has(k)
        ? (pendingRefEdits[k] ? pendingRefEdits[k].label : before)
        : (pendingEdits[k] !== undefined ? pendingEdits[k] : before);
      return !!before && !String(after ?? '').trim();
    });
    setMissingRequired(new Set(emptied));
    if (emptied.length) {
      setInlineMsg({ kind: 'err', text: `שדות חובה ב-QC לא יכולים להישאר ריקים: ${emptied.map(k => DETAIL_FIELD_LABEL[k] ?? k).join(', ')}` });
      return false;
    }
    setSavingInline(true); setInlineMsg(null);
    const { status: pendingStatus, ...restFields } = pendingEdits;
    try {
      const found = await findConflicts().catch(() => null);
      if (found) {
        setSavingInline(false);
        const choice = await new Promise<'overwrite' | 'review' | 'cancel'>(res => { conflictResolve.current = res; setConflict(found); });
        setConflict(null); conflictResolve.current = null;
        if (choice === 'review') {
          // show QC's current values under the pending changes; save again after a look
          setDetail(found.fresh); baseDetailRef.current = found.fresh;
          setInlineMsg({ kind: 'err', text: 'הטופס עודכן לפי QC — השינויים שלך נשמרו בו. בדוק ולחץ שוב "עדכן תקלה".' });
          return false;
        }
        if (choice === 'cancel') return false;
        setSavingInline(true);
      }
      const r = await axios.patch(`${API}/qc/defects/${encodeURIComponent(defectId)}`, {
        fields: restFields, refFields: pendingRefEdits,
        status: pendingStatus ?? null, comment: newComment?.trim() || null,
      }, { headers });
      setPendingEdits({}); setPendingRefEdits({}); setNewComment(null); setEditingField(null);
      setInlineMsg({ kind: 'ok', text: `✓ התקלה עודכנה ב-QC${r.data?.commentAdded ? ' · ההערה נוספה' : ''}` });
      setDetailReload(n => n + 1);    // show what QC now holds
      return true;
    } catch (err: any) {
      // nothing was written — the changes stay on screen (and in the draft) to fix and retry
      if (err?.response?.status === 423) {
        const d = err.response.data ?? {};
        setLock(prev => ({ ...prev, locked: true, by: d.lockedBy ?? prev?.by, byName: d.lockedByName ?? prev?.byName, since: d.lockedSince ?? prev?.since, source: 'qc' }));
        setInlineMsg({ kind: 'err', text: d.message || 'התקלה נעולה לעריכה ב-QC — לא נשמר דבר.' });
      } else if (err?.response?.status === 401) {
        setSessionExpired(true);
        setInlineMsg({ kind: 'err', text: 'ההתחברות פגה — התחבר מחדש. השינויים שמורים כטיוטה ויוצעו לשחזור כשתפתח את התקלה.' });
      } else {
        setInlineMsg({ kind: 'err', text: err?.response?.data?.message || 'עדכון התקלה נכשל' });
      }
      return false;
    } finally {
      setSavingInline(false);
    }
  };

  // ── Leave guard: back, sidebar, top bar, logout, refresh / close tab
  const { confirmLeave } = useUnsavedChanges();
  useLeaveGuard({
    count: () => pendingCount,
    label: () => `תקלה #${defectId}`,
    save: saveInlineEdits,
    discard: () => { if (!sessionExpired) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } } },
  });
  const goBack = async () => { if (await confirmLeave()) onBack(); };
  // a text editor that is open: a click outside keeps what was typed
  const outsideCommit = useRef<(() => void) | null>(null);

  // The admin-configured field pool (AdminPanel's "עמודות תקלות ייצור" panel)
  // decides which fields are even available; the per-user category picker
  // below (independent, localStorage-persisted like VersionOverview's) only
  // decides how to show/group whichever of those are available — same
  // separation of concerns as the TARGET-defect screen's two independent
  // pickers (spec confirmed 2026-08-30).
  // Same field set wherever the form is opened from (user report 2026-10-05:
  // the bug dashboard's oldest-open list, the defects module and version
  // overview passed [] and got every field, drill-downs passed the saved
  // list). The form reads the saved list itself; a caller's non-empty list
  // still wins.
  const [savedDetailFields, setSavedDetailFields] = useState<string[] | null>(null);
  useEffect(() => {
    if (detailFields.length > 0) return;
    axios.get(`${API}/qc/open-prod-defects-config`, { headers })
      .then(r => setSavedDetailFields(Array.isArray(r.data?.detailFields) ? r.data.detailFields : []))
      .catch(() => setSavedDetailFields([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, detailFields.length]);
  const effectiveDetailFields = detailFields.length > 0 ? detailFields : (savedDetailFields ?? []);
  const fieldsToShow = effectiveDetailFields.length > 0 ? effectiveDetailFields : DETAIL_FIELDS.map(f => f.key);
  const titleShown = fieldsToShow.includes('title');
  // The "התאמת שדות" dialog offers the FULL field vocabulary (every
  // TargetDefectDto column), not just the admin-configured `detailFields`
  // subset — user-flagged 2026-09-07 ("לא כל השדות מופיעים ברשימה"). Empty
  // fields are still auto-hidden from the actual panel (detail[k] !== undefined),
  // so surfacing them all in the picker is safe.
  // Default groups stay lean — only the admin-configured / default field set,
  // NOT the full picker vocabulary (which would fill the panel with empty
  // "—" rows). The "התאמת שדות" dialog is where the rest live.
  const defaultGroups = useMemo(() => {
    // + fields added after an admin saved the old field list (APK, 2026-10-04)
    const allowed = new Set([...fieldsToShow, ...BUILTIN_ALWAYS_SHOWN_FIELDS]);
    return DEFAULT_OPEN_PROD_DETAIL_GROUPS
      .map(g => ({ ...g, fields: g.fields.filter(k => allowed.has(k)) }))
      .filter(g => g.fields.length > 0);
  }, [fieldsToShow]);

  // Panels come from the admin-designed layout for this user (team -> role ->
  // default, AdminPanel "תבנית טופס תקלה", 2026-10-04) - replaces the old
  // per-browser localStorage picker. No layout set anywhere -> built-in panels.
  const [serverLayout, setServerLayout] = useState<{ panels: { name: string; fields: string[]; wide?: string[] }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/qc/defect-form-layout`, { headers })
      .then(r => { if (alive) setServerLayout(r.data?.layout ?? null); })
      .catch(() => { if (alive) setServerLayout(null); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const baseGroups: DetailGroup[] = serverLayout
    ? serverLayout.panels.map(pn => ({ title: pn.name, fields: pn.fields, wide: pn.wide }))
    : defaultGroups;
  // 📎 attachments: wherever the layout placed it, else end of the first panel (full row).
  const detailGroups: DetailGroup[] = baseGroups.some(g => g.fields.includes(ATTACHMENTS_FIELD)) || baseGroups.length === 0
    ? baseGroups
    : baseGroups.map((g, i) => (i === 0 ? { ...g, fields: [...g.fields, ATTACHMENTS_FIELD], wide: [...(g.wide ?? []), ATTACHMENTS_FIELD] } : g));
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  // Long-text boxes open to full height on demand (less scrolling, user ask 2026-10-04).
  const [expandedText, setExpandedText] = useState<{ description: boolean; notes: boolean }>({ description: false, notes: false });


  // Everything a field cell needs — the same cell renders the create form
  // (CreateDefectScreen), so both forms always look and behave alike.
  const refValueOf = (k: string) => pendingRefEdits[k]?.label ?? String((detail as any)?.[k] ?? '');
  const fieldCtx: DefectFieldsCtx = {
    valueOf: k => (refEditableFieldKeys.has(k) ? refValueOf(k) : (pendingEdits[k] !== undefined ? pendingEdits[k] : String((detail as any)?.[k] ?? ''))),
    isDirty: k => (refEditableFieldKeys.has(k) ? pendingRefEdits[k] !== undefined : pendingEdits[k] !== undefined),
    isEditable: k => !LOCKED_DETAIL_FIELDS.has(k) && (k === 'status'
      ? canQcWrite && allowedTransitions !== null
      : (editableFieldKeys.has(k) || refEditableFieldKeys.has(k))),
    lockReason: k => (k === 'status' && canQcWrite && allowedTransitions === null
      ? 'הצוות שלך לא משויך לקבוצת QC — לא ניתן לשנות סטטוס מכאן'
      : LOCKED_DETAIL_FIELDS.has(k) ? 'שדה נעול — לא משתנה אחרי פתיחת התקלה' : undefined),
    editingField, setEditingField,
    commitField: (k, v) => { setMissingRequired(m => { if (!m.has(k)) return m; const n = new Set(m); n.delete(k); return n; }); commitInlineField(k, v); },
    commitPair: (rk, ck, rel, cyc) => { setMissingRequired(m => { const n = new Set(m); n.delete(rk); n.delete(ck); return n; }); commitRefPair(rk, ck, rel, cyc); },
    outsideCommit,
    required: CREATE_REQUIRED_FIELDS, missing: missingRequired,
    teamEnv, fieldPicklists, fieldKinds, personDirectory, personTeams, releaseOptions,
    currentStatus, allowedTransitions,
    loadScoped: (k, release, cr) => loadReleaseScopedOptions(headers, k, release, cr),
  };
  const showDescription = fieldsToShow.includes('description');
  const showNotes = fieldsToShow.includes('notes');

  return (
    <div className="px-7 py-5">
      {/* ── סרגל פעולות עליון — כפתורי משנה קומפקטיים ── */}
      {/* fixed height: the save buttons appearing must not push the form down */}
      <div className="flex min-h-[34px] items-center justify-between mb-[18px]">
        <BackLink onClick={goBack} label="חזרה לטבלה" />
        <div className="flex items-center gap-2">
          {inlineMsg && (
            <span className={`text-[13px] font-semibold ${inlineMsg.kind === 'ok' ? 'text-success' : 'text-danger'}`}>{inlineMsg.text}</span>
          )}
          {canQcWrite && blocked && (
            <span className="text-xs text-warning" title={blocked}>⚠ חיבור הכתיבה ל-QC לא זמין כרגע — שמירה עלולה להיכשל</span>
          )}
          {pendingCount > 0 && (
            <>
              <button onClick={cancelInlineEdit} disabled={savingInline} className={DETAIL_TOP_BTN_CLASS}>בטל שינויים</button>
              <button
                onClick={saveInlineEdits}
                disabled={savingInline}
                className={`px-4 py-1.5 rounded-md border-none cursor-pointer text-[13px] font-bold bg-primary text-white ${savingInline ? 'opacity-50' : 'opacity-100'}`}
              >
                {savingInline ? 'מעדכן ב-QC…' : `✔ עדכן תקלה (${pendingCount})`}
              </button>
            </>
          )}
        </div>
      </div>

      {lock?.locked && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[13px] text-foreground" style={{ borderColor: '#D97706', background: '#FFF7E6' }}>
          <span>🔒 התקלה פתוחה כרגע לעריכה{lock.byName || lock.by ? <> אצל <b>{lock.byName || lock.by}</b></> : ' אצל משתמש אחר'} ב-QC
            {lock.since ? <> (מ-{formatDateTime(lock.since)})</> : null} — שינויים לא יישמרו עד שתשוחרר.</span>
          <button type="button" onClick={checkLock} className="cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-xs">בדוק שוב</button>
          {pendingCount > 0 && (
            <button type="button" onClick={() => { void saveInlineEdits(); }} disabled={savingInline}
              className="cursor-pointer rounded-md border-none bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">נסה לשמור שוב</button>
          )}
        </div>
      )}
      {draftOffer && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[13px]" style={{ borderColor: JIRA.blue, background: '#eef4ff' }}>
          <span>📝 נמצאו שינויים שלא נשמרו ב-QC מ-{formatDateTime(new Date(draftOffer.at).toISOString())}
            {' '}({draftChangeCount(draftOffer)} {draftChangeCount(draftOffer) === 1 ? 'שינוי' : 'שינויים'})</span>
          <button type="button" onClick={restoreDraft} className="cursor-pointer rounded-md border-none bg-primary px-3 py-1 text-xs font-semibold text-white">שחזר</button>
          <button type="button" onClick={dropDraft} className="cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-xs">מחק</button>
        </div>
      )}
      <BrandedDialog
        open={!!conflict} onClose={() => conflictResolve.current?.('cancel')} closeOnBackdrop={false} zIndex={7000} width="md"
        icon="⚠" title="התקלה עודכנה ב-QC בינתיים"
        footer={<>
          <DialogButton variant="warning" onClick={() => conflictResolve.current?.('overwrite')}>שמור בכל זאת</DialogButton>
          <DialogButton variant="primary" onClick={() => conflictResolve.current?.('review')}>טען את הנתונים מ-QC ובדוק</DialogButton>
          <DialogButton variant="secondary" onClick={() => conflictResolve.current?.('cancel')}>ביטול</DialogButton>
        </>}
      >
        <div className="flex flex-col gap-3 text-sm text-foreground">
          {conflict?.changes.some(c => c.mine) && (
            <div className="font-semibold text-danger">בשדות המסומנים ⚠ גם אתה שינית — "שמור בכל זאת" ידרוס את השינוי של המשתמש האחר.</div>
          )}
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="text-right text-xs text-subtle-foreground">
              <th className="py-1 pl-2">שדה</th><th className="py-1 pl-2">היה</th><th className="py-1 pl-2">עכשיו ב-QC</th><th className="py-1">מי / מתי</th>
            </tr></thead>
            <tbody>
              {conflict?.changes.map(c => (
                <tr key={c.key} className="border-t border-border align-top">
                  <td className="py-1.5 pl-2 font-semibold" dir="ltr" style={{ textAlign: 'right' }}>{c.mine && <span title="גם אתה שינית את השדה הזה">⚠ </span>}{c.label}</td>
                  <td className="max-w-[180px] truncate py-1.5 pl-2 text-muted-foreground" title={c.before} dir="auto">{c.key === 'notes' || c.key === 'description' ? '…' : (c.before || '—')}</td>
                  <td className="max-w-[180px] truncate py-1.5 pl-2" title={c.after} dir="auto">{c.key === 'notes' ? 'נוספה / שונתה הערה' : c.key === 'description' ? 'התיאור שונה' : (c.after || '—')}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">{c.by ? <>{c.by}{c.at ? <> · {formatDateTime(c.at)}</> : null}</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground">השדות שלא שינית לא נדרסים — רק השדות ששינית נכתבים ל-QC. ההערה החדשה תמיד מתווספת לסוף.</div>
        </div>
      </BrandedDialog>

      {detailLoading && <div className="text-center p-10 text-subtle-foreground">טוען...</div>}
      {!detailLoading && !detail && (
        <div className="text-center p-10 text-subtle-foreground">לא נמצא מידע מלא עבור תקלה זו</div>
      )}

      {!detailLoading && detail && (
        // Redesigned 2026-09-22 to match the create-defect form's visual
        // language (co-designed with the user via a mockup — see
        // project-defect-create-form-redesign-2026-09-22 memory): symmetric
        // equal-size boxes, one per field group, in a responsive grid, full
        // page width — instead of the old fixed-380px single-column sidebar
        // (which stacked every group in one tall list). Layout-only change:
        // every field row's own JSX below (dirty-state, double-click
        // editing, bidi handling) is untouched from before this redesign.
        // The old dir="ltr" trick on the outer wrapper existed only to force
        // the sidebar-then-main ordering in a 2-column flex row (feedback
        // 2026-09-14) — no longer needed now that groups stack vertically
        // above the main content instead of sitting beside it, so this whole
        // section is plain dir="rtl" like the rest of the app.
        <div className="flex flex-col gap-4" dir="rtl">
          {/* Title in its own card at the top, as in the create form. */}
          {(() => {
            const titleText = titleShown ? (detail.title || 'ללא כותרת') : 'פרטי תקלה';
            const titleRtl = hasHebrew(titleText);
            return (
              <div className="rounded-xl px-6 py-5" style={{ background: '#fff' }}>
                <label className="text-xs font-bold text-subtle-foreground block" style={{ direction: 'ltr', textAlign: 'left' }}>Title</label>
                <div className="mt-1.5 flex items-center gap-3 px-3 py-2" style={VALUE_BOX_STYLE}>
                  <span className="font-semibold shrink-0" style={{ color: JIRA.blue, direction: 'ltr' }}>#{defectId}</span>
                  <span
                    className={cn('min-w-0 flex-1 text-[15px] font-semibold leading-snug break-words', titleRtl ? 'text-right [direction:rtl]' : 'text-left [direction:ltr]')}
                    style={{ color: JIRA.text }}
                  >
                    {titleText}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* direction: ltr here controls only the LEFT-TO-RIGHT box order
              (זיהוי leftmost, then גילוי, continuing left→right — user
              request 2026-09-23) — each box below restores dir="rtl" for its
              own Hebrew title/labels/values, same technique CreateDefectScreen
              already uses for its own fields-flow container. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, direction: 'ltr' }}>
            {(() => {
              const groups = detailGroups
                .map(g => ({ ...g, fields: g.fields.filter(k => k === ATTACHMENTS_FIELD || detail[k] !== undefined) }))
                .filter(g => g.fields.length > 0);
              return groups.map(group => (
                <div
                  key={group.title}
                  dir="rtl"
                  className="rounded-xl overflow-hidden px-6 py-6"
                  style={{ background: '#fff', height: '100%' }}
                >
                  {/* dir="auto" + text-start: a Hebrew title sits right, an English one left (user ask 2026-10-06) */}
                  <div dir="auto" className="text-sm font-bold mb-3 text-foreground text-start">
                    {group.title}
                  </div>
                  {/* Aligned grid (user, 2026-10-08): every field box in a column has
                      the same width, values stay on one line (full value on hover);
                      a "wide" field (layout ↔) takes the whole row and may wrap. */}
                  <div className="grid gap-x-3 gap-y-3" style={{ direction: 'ltr', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                    {group.fields.map(key => {
                      const isWide = !!group.wide?.includes(key);
                      if (key === ATTACHMENTS_FIELD) {
                        return (
                          <div key={key} className="flex min-w-0 flex-col items-start gap-1 px-1 py-0.5" style={{ gridColumn: '1 / -1' }}>
                            <span className="text-xs font-bold tracking-wide" style={{ color: JIRA.textSubtle }}>{ATTACHMENTS_FIELD_DEF.label}</span>
                            <AttachmentsSection defectId={defectId} token={token} compact />
                          </div>
                        );
                      }
                      return <DefectFieldCell key={key} fieldKey={key} wide={isWide} ctx={fieldCtx} />;
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* Description + Comments share one card, as in the create form;
              each opens to full height on demand so long text needs as
              little scrolling as possible (user ask 2026-10-04). */}
          {/* Side by side (user ask 2026-10-06): Description on the left,
              Comments to its right; stacks on narrow screens. */}
          {(showDescription || showNotes) && (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', direction: 'ltr' }}>
              {([
                showDescription && { key: 'description' as const, label: DETAIL_FIELD_LABEL.description ?? 'Description', max: 'max-h-[280px]' },
                showNotes && { key: 'notes' as const, label: DETAIL_FIELD_LABEL.notes ?? 'Comments', max: 'max-h-[440px]' },
              ].filter(Boolean) as { key: 'description' | 'notes'; label: string; max: string }[]).map(sec => {
                const expanded = expandedText[sec.key];
                const noteCount = sec.key === 'notes' ? parseNoteEntries(String(detail.notes ?? '')).length : 0;
                return (
                  <section key={sec.key} dir="rtl" className="min-w-0 rounded-xl px-6 py-5" style={{ background: '#fff' }}>
                    {/* English title on the left, expand toggle on the right */}
                    <div className="mb-1.5 flex items-center justify-between gap-2" style={{ direction: 'ltr' }}>
                      <label className="text-xs font-bold text-subtle-foreground" style={{ direction: 'ltr', textAlign: 'left' }}>
                        {sec.label}{noteCount > 1 ? ` · ${noteCount}` : ''}
                      </label>
                      <button
                        type="button"
                        onClick={() => setExpandedText(prev => ({ ...prev, [sec.key]: !prev[sec.key] }))}
                        className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold"
                        style={{ color: JIRA.blue }}
                      >
                        {expanded ? '⤡ צמצם' : '⤢ הרחב'}
                      </button>
                    </div>
                    <div
                      className={cn('px-3 py-2 leading-relaxed', !expanded && `${sec.max} overflow-y-auto`)}
                      style={{ color: JIRA.text, ...VALUE_BOX_STYLE }}
                    >
                      {sec.key === 'description'
                        ? <div className="text-[15px] text-right whitespace-pre-wrap break-words">{detail.description ? decodeDefectText(String(detail.description)) : NOT_SET}</div>
                        : (String(detail.notes ?? '').replace(/_{5,}/g, '').trim() ? renderNotesField(detail.notes) : NOT_SET)}
                    </div>
                    {sec.key === 'notes' && canQcWrite && (
                      newComment === null ? (
                        <button type="button" onClick={openNewComment}
                          className="mt-2 cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-xs font-semibold text-primary">
                          ➕ הוסף הערה
                        </button>
                      ) : (
                        // QC's own add-comment format: signature line, then the text
                        <div className="mt-2 rounded-md border p-2.5" style={{ borderColor: JIRA.blue, background: '#f7faff' }}>
                          <div className="text-left text-sm font-semibold" style={{ color: JIRA.textSubtle, direction: 'ltr' }}>
                            {commentSignature || '…'}
                          </div>
                          <textarea
                            autoFocus value={newComment} onChange={e => setNewComment(e.target.value)} rows={4} dir="auto"
                            placeholder="כתוב את ההערה…"
                            className="mt-1 w-full resize-y rounded-sm border border-border bg-white p-2 text-[14px] text-foreground"
                          />
                          <div className="mt-1 flex items-center justify-between text-[11px] text-subtle-foreground">
                            <span>תתווסף בסוף ההערות בלחיצה על "עדכן תקלה"</span>
                            <button type="button" onClick={() => setNewComment(null)} className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-danger">הסר</button>
                          </div>
                        </div>
                      )
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div dir="rtl" className="flex">
            <button
              onClick={() => setHistoryModalOpen(true)}
              className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-bold hover:underline"
              style={{ color: JIRA.blue }}
            >
              🕘 היסטוריית שינויים ←
            </button>
          </div>
        </div>
      )}

      {historyModalOpen && (
        <div
          onClick={() => setHistoryModalOpen(false)}
          className="fixed inset-0 z-[5000] flex items-center justify-center p-6"
          style={{ background: DIALOG_OVERLAY_BG }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-xl px-5 py-[18px] w-[760px] max-w-[96vw] max-h-[86vh] overflow-y-auto"
            style={{ boxShadow: DIALOG_PANEL_SHADOW }}
          >
            <DialogBrandBar icon="🕘" title={`היסטוריית שינויים — תקלה ${defectId}`} onClose={() => setHistoryModalOpen(false)}
              style={{ margin: '-18px -20px 12px', position: 'sticky', top: '-18px', zIndex: 2 }} />
            <FieldChangeHistorySection defectId={defectId} token={token} defaultOpen />
          </div>
        </div>
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
      {/* Row layout matches DefectsHubView's BreakdownPanel (2026-09-29 fix,
          applied here too): content-sized label instead of a fixed width so
          short labels hug the bar instead of leaving a gap, and
          scrollbarGutter reserves space so the RTL-left scrollbar doesn't
          overlap the count column. */}
      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto pl-2" style={{ scrollbarGutter: 'stable' }}>
        {rows.length === 0 && <div className="text-xs text-subtle-foreground">אין נתונים</div>}
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground max-w-[40%] shrink-0 truncate" title={r.label}>{r.label}</div>
            <div className="min-w-0 flex-1 h-3.5 bg-muted rounded-sm overflow-hidden">
              <div className="h-full bg-primary rounded-sm" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="text-xs text-foreground w-6 shrink-0 text-left">{r.count}</div>
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

// Same as groupCount, but for a field that can hold several ';'-joined team
// names on one row (responsibility) — each real team gets its own bar
// instead of one bar per raw combination.
function groupCountByTeam(items: OpenProdDefectMonthRow[], keyFn: (r: OpenProdDefectMonthRow) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const teams = splitTeams(keyFn(item));
    const keys = teams.length > 0 ? teams : ['ללא סיווג'];
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export const OpenProdDefectsView: React.FC<Props> = ({ token }) => {
  const dialog = useDialog();
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
  const [showCreateScreen, setShowCreateScreen] = useState(false);
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
      dialog.alert(lines.join('\n\n'), 'עדכון קבוצתי', failed.length > 0 ? 'warning' : 'success');
      setSelectedDefectIds(new Set());
      setBulkStatus('');
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'עדכון קבוצתי נכשל', 'שגיאה', 'danger');
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
  // One option per real team, not per raw combination (a row's responsibility
  // can be "CRM Team;TopTech Dev Team" when a defect spans two teams).
  const responsibilityOptions = useMemo(() => Array.from(new Set(rows.flatMap(r => splitTeams(r.responsibility)))).sort(), [rows]);
  const statusOptions         = useMemo(() => Array.from(new Set(rows.map(r => r.statusAtMonth).filter(Boolean))).sort() as string[], [rows]);
  const yearOptions           = useMemo(() => Array.from(new Set(rows.map(r => r.monthLabel.slice(0, 4)).filter(Boolean))).sort() as string[], [rows]);
  const fixTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.fixType).filter(Boolean))).sort() as string[], [rows]);
  const bugTypeOptions        = useMemo(() => Array.from(new Set(rows.map(r => r.bugType).filter(Boolean))).sort() as string[], [rows]);

  const filteredRows = useMemo(() => rows.filter(r =>
    (fResponsibility.length === 0 || splitTeams(r.responsibility).some(t => fResponsibility.includes(t))) &&
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

  const monthWidthsApi = useColumnWidths('deploycenter_openprod_defect_column_widths');
  const { startResize: startMonthColResize, manualCount: monthManualCount, resetAll: resetMonthWidths } = monthWidthsApi;
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
  const saveCurrentView = async () => {
    const name = await dialog.prompt({ title: 'שמירת תצוגה', label: 'שם לתצוגה השמורה', placeholder: 'למשל: פתוחות קריטיות', confirmLabel: 'שמור' });
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
  // Auto-fit to the card (2026-10-06) — same as every other defect table.
  const monthFit = useAutoFitTable({
    rows: sortedMonthRows,
    columns: tableColumns.map(key => ({ key, label: TABLE_FIELD_LABEL[key] ?? key })),
    getValue: (r, key) => (r as any)[key],
    widths: monthWidthsApi,
    extra: key => (key === 'severity' || key === 'statusAtMonth' || key === 'currentStatus' ? 22 : key === 'defectId' ? 30 : PERSON_BADGE_FIELDS.has(key) ? 30 : 0),
    leadingWidth: 32,
  });

  if (showCreateScreen) {
    return (
      <CreateDefectScreen
        token={token}
        onBack={() => setShowCreateScreen(false)}
        onCreated={(id) => { setShowCreateScreen(false); setDetailDefectId(id); }}
      />
    );
  }

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
            <button onClick={() => setShowCreateScreen(true)} className={DETAIL_TOP_BTN_CLASS}>+ תקלה חדשה</button>
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
            {monthManualCount > 0 && (
              <div className="flex justify-end border-b border-border px-2 py-1">
                <button onClick={resetMonthWidths} title="בטל רוחבים שנקבעו ידנית והתאם אוטומטית" className="cursor-pointer border-none bg-transparent text-xs font-semibold text-primary">↔ התאם רוחב</button>
              </div>
            )}
            <div ref={monthFit.boxRef} className="overflow-x-auto">
              <table className="border-collapse text-xs" style={monthFit.tableStyle}>
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
                        className="relative px-2 py-2 text-right font-bold text-[11px] tracking-wide cursor-pointer select-none whitespace-normal break-words align-bottom leading-tight"
                        style={{ color: JIRA.textSubtle, borderBottom: `2px solid ${JIRA.greyN40}`, width: monthFit.colWidth(key) }}
                      >
                        {TABLE_FIELD_LABEL[key] ?? key}
                        {sortKey === key && <span className="me-1 text-primary">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                        <ColumnResizeHandle onMouseDown={e => startMonthColResize(key, e, monthFit.colWidth(key))} />
                      </th>
                    ))}
                  </tr>
                  <ColumnFilterRow
                    columns={tableColumns.map(key => ({ key, label: TABLE_FIELD_LABEL[key] ?? key }))}
                    getWidth={monthFit.colWidth}
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
                        const wraps = monthFit.wraps(key);
                        const content = isDefectCol ? (value ? <IssueKeyLink id={value} /> : '—')
                          : isSeverityCol ? <SeverityBadge severity={value ?? ''} />
                          : isStatusCol ? <StatusBadge status={value ?? ''} />
                          : PERSON_BADGE_FIELDS.has(key) && value ? <PersonAvatar name={String(value)} />
                          : (value ?? '—');
                        return (
                          <td
                            key={key}
                            title={wraps ? String(value ?? '') : undefined}
                            className={`px-2 py-[7px] ${wraps ? '' : 'overflow-hidden text-ellipsis whitespace-nowrap'} ${isDefectCol || isSeverityCol || isStatusCol ? 'text-center' : ''} ${isDefectCol ? 'font-semibold' : 'font-normal'}`}
                            style={{
                              borderBottom: `1px solid ${JIRA.greyN40}`,
                              width: monthFit.colWidth(key), verticalAlign: 'top', lineHeight: 1.45,
                              color: isDefectCol || isSeverityCol || isStatusCol ? undefined : JIRA.text,
                            }}
                          >
                            {wraps ? <div style={WRAP_CLAMP_STYLE}>{content}</div> : content}
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
            <BreakdownPanel title="לפי צוות" total={monthRows.length} rows={groupCountByTeam(monthRows, r => r.responsibility)} />
            <BreakdownPanel title="לפי סוג תקלה" total={monthRows.length} rows={groupCount(monthRows, r => r.bugType)} />
          </div>
        </>
      )}
    </div>
  );
};

const selectClass = 'px-2.5 py-[7px] border border-border rounded-md text-[17px] bg-card text-foreground min-w-[150px]';

export default OpenProdDefectsView;
