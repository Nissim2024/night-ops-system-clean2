import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, JIRA } from '../../theme';
import { Avatar } from '../ui';
import { formatDateTime } from '../../utils/dateFormat';
import { cn } from '../../lib/utils';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Shared building blocks for "defect detail" screens across the app —
// extracted from VersionOverview.tsx's TARGET-defect work (2026-08-30) so
// every defect-detail screen (TARGET, open-production defects via
// DefectDetailScreen/DefectDrilldownModal, and future ones) gets the same
// language-aware alignment, person/team badges, notes parsing, and
// field/category picker instead of N drifting copies. Field keys are plain
// strings here (not keyof SomeDefect) since different screens have
// genuinely different field-shape interfaces — see the investigation
// 2026-08-30 that found ~9 backend DTOs / ~12 frontend interfaces for
// "defect" across the app.

export function hasHebrew(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x0590 && c <= 0x05ff) return true;
  }
  return false;
}

// Stable hash-per-name palette — canonical source is VersionsView.tsx's
// deployment-plan team badges (feedback 2026-09-14: the defect-table
// "אחראי" badge used a different 8-color palette that didn't match the
// deployment plan's colors for the same team name). Centralized here so
// every person/team badge across the app — defect tables, CR review,
// go-live plan, deployment plan — resolves the same team name to the same
// colors instead of each file re-hashing its own.
export const TEAM_PALETTE: { bg: string; color: string }[] = [
  { bg: '#dbeafe', color: '#1e40af' }, { bg: '#dcfce7', color: '#166534' },
  { bg: '#fef3c7', color: '#92400e' }, { bg: '#fce7f3', color: '#9d174d' },
  { bg: '#ede9fe', color: '#5b21b6' }, { bg: '#ffedd5', color: '#9a3412' },
  { bg: '#cffafe', color: '#164e63' }, { bg: '#f0fdf4', color: '#14532d' },
  { bg: '#fdf4ff', color: '#7e22ce' }, { bg: '#fff1f2', color: '#9f1239' },
];
export function teamColor(name: string): { bg: string; color: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

// Picks black or white text for a given badge background so every colored
// badge stays readable regardless of which color it ends up using — plain
// white text on a light/bright color (amber #E8AF00 in particular, used by
// both TEAM_PALETTE and STATUS_COLOR's "Pending"/"At Work") reads as barely
// legible (spec confirmed 2026-09-03: "פונטים ברורים גם אם רקע השדה בצבע
// אחר"). Simplified WCAG relative-luminance check, good enough for the small
// fixed palettes this app uses — not a full color-management system.
export function contrastTextColor(bgHex: string): string {
  const hex = bgHex.replace('#', '');
  if (hex.length !== 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? C.textPrimary : '#fff';
}

// No fontSize set on any of these badges/labels — they deliberately INHERIT
// the ambient font-size from whichever context renders them (a table cell,
// a detail-screen field grid, a home-dashboard row, ...), each of which
// already sets its own consistent size. Badges used to hardcode 12-13px
// regardless of context, so a row's plain-text values and its badge values
// visibly differed in size within the same table/screen (spec confirmed
// 2026-09-03: "הערכים בשדות צריכים להיות בפונט עם גודל אחיד").
export function NameBadge({ name }: { name: string }) {
  const { bg, color } = teamColor(name);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-sm px-2 py-0.5 font-semibold"
      style={{ color, background: bg }}
    >
      {name}
    </span>
  );
}

// One fixed color for every defect ID everywhere in the app (not a
// per-value/semantic mapping like NameBadge/status badges — the whole point
// is that a defect number always looks the same regardless of which module
// shows it), so the same visual identity carries across every screen that
// mentions a defect number (spec confirmed 2026-09-03).
export function DefectIdBadge({ id }: { id: string | number }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-sm bg-primary px-2 py-0.5 font-semibold font-mono"
      style={{ color: contrastTextColor(C.brand) }}
    >
      {id}
    </span>
  );
}

// Avatar-circle + first-name, matching the implementation-plan module's
// pattern (ui.tsx's Avatar). Only reads well when `name` is a real "First
// Last" string — a raw QC login (no space) degrades gracefully to a single
// letter + the login itself.
export function PersonAvatar({ name, full = false }: { name: string; full?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 [direction:ltr]">
      <Avatar name={name} size={20} />
      <span className="text-muted-foreground">{full ? name : name.split(' ')[0]}</span>
    </span>
  );
}

// ── Jira-style issue chrome ──────────────────────────────────────────────
// Centralizes what used to be near-identical copies in DefectDrilldownModal,
// OpenProdDefectsView and VersionOverview (SEVERITY_COLOR/STATUS_COLOR/
// softChipStyle/PRIORITY_META) so every defect table and the shared detail
// panel render severity/status/priority/id identically (feedback 2026-09-10:
// "אני רוצה שתעצב את כל טבלאות התקלות" — one consistent Jira look, not N
// drifting per-file copies).
export const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger, Severe: C.danger, Medium: '#D97706', Low: C.textMuted,
};
export const STATUS_COLOR: Record<string, string> = {
  New: C.statusOpen, Open: C.statusOpen,
  Pending: C.statusInProgress, 'At Work': C.statusInProgress,
  Fixed_Dev: C.warning, Fixed_Test: C.success, Fixed: C.success, Closed: C.success,
  Reopen: C.danger, Rejected: C.textMuted, Canceled: C.textMuted,
};
export const DEFAULT_STATUS_COLOR = C.textMuted;

// Soft pill — a lozenge: the field's own colour as text over a 14%-alpha
// wash of it (Jira's "status lozenge" treatment).
export function hexTint(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return C.bgNested;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
export function SoftPill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, background: hexTint(color) }}
    >
      {text}
    </span>
  );
}
export function SeverityBadge({ severity }: { severity: string }) {
  if (!severity) return <span style={{ color: JIRA.textSubtle }}>—</span>;
  return <SoftPill text={severity} color={SEVERITY_COLOR[severity] ?? C.textSecondary} />;
}
export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span style={{ color: JIRA.textSubtle }}>—</span>;
  return <SoftPill text={status} color={STATUS_COLOR[status] ?? DEFAULT_STATUS_COLOR} />;
}

// Jira-style priority arrows — a coloured glyph + the raw label.
const PRIORITY_META: { test: RegExp; glyph: string; color: string }[] = [
  { test: /highest|urgent|critical|show ?stopper|blocker|דחוף|קריטי/i, glyph: '⏫', color: C.danger },
  { test: /high|גבוה/i,                                                glyph: '▲',  color: '#D04437' },
  { test: /medium|normal|בינונ/i,                                      glyph: '▲',  color: '#E8930A' },
  { test: /low|minor|נמוכ/i,                                           glyph: '▼',  color: '#2A8735' },
  { test: /lowest|trivial/i,                                           glyph: '⏬', color: JIRA.textSubtle },
];
export function PriorityCell({ value }: { value: string }) {
  if (!value) return <span style={{ color: JIRA.textSubtle }}>—</span>;
  const m = PRIORITY_META.find(p => p.test.test(value));
  return (
    <span className="inline-flex items-center gap-[5px] text-xs [direction:ltr]" style={{ color: JIRA.text }}>
      <span aria-hidden className="text-[11px] leading-none" style={{ color: m?.color ?? JIRA.textSubtle }}>{m?.glyph ?? '■'}</span>
      {value}
    </span>
  );
}

// Jira issue-type icon — every row here is a Bug, so one fixed red/orange
// square (matching Jira's own Bug issue-type icon colour) rather than a
// per-row lookup; sits beside the key exactly like Jira's issue navigator.
const BUG_TYPE_COLOR = '#E2483D';
export function IssueTypeIcon() {
  return (
    <span
      aria-hidden
      title="Bug"
      className="inline-block h-3 w-3 shrink-0 rounded-[3px]"
      style={{ background: BUG_TYPE_COLOR }}
    />
  );
}
// Issue key — small type icon + the id as a Jira-blue link (Jira's "OP-1234"
// convention). One shared identity for the id column across every defect
// table (feedback 2026-09-10) — replaces the filled DefectIdBadge in TABLE
// contexts; DefectIdBadge itself is untouched for the other places it's used.
export function IssueKeyLink({ id }: { id: string | number }) {
  return (
    <span className="inline-flex items-center gap-1.5 [direction:ltr]">
      <IssueTypeIcon />
      <span className="font-semibold" style={{ color: JIRA.blue }}>#{id}</span>
    </span>
  );
}

// QC's Notes/dev-comments field concatenates one history entry per prior
// comment, each separated by a run of underscores and headed by
// "Name <login>, DD/MM/YYYY:" — e.g. "________...Maamon Alwan <maamona>,
// 18/01/2026:בוצע בדיקה ללקוח". Split on the underscore runs, pull the
// header off each chunk when present, and render header (left/ltr) + forced
// line break + body (right/rtl if it has any Hebrew, left/ltr if pure
// English). A chunk that doesn't match the header shape (e.g. legacy free
// text before the first separator) falls back to plain hasHebrew-based
// alignment.
const NOTE_ENTRY_HEADER_RE = /^\s*(.+?)\s*<([^<>]+)>\s*,\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*:\s*/;
export function renderNotesField(raw: string | null | undefined) {
  if (!raw?.trim()) return '—';
  const chunks = raw.split(/_{5,}/).map(c => c.trim()).filter(Boolean);
  if (chunks.length === 0) return '—';
  return (
    <div className="flex flex-col gap-3.5">
      {chunks.map((chunk, i) => {
        const m = chunk.match(NOTE_ENTRY_HEADER_RE);
        if (m) {
          const header = `${m[1]} <${m[2]}>, ${m[3]}:`;
          const body = chunk.slice(m[0].length).trim();
          const bodyRtl = hasHebrew(body);
          return (
            <div key={i} className={cn(i > 0 && 'border-t border-dashed border-border pt-2.5')}>
              <div className="text-left text-sm font-semibold text-subtle-foreground [direction:ltr]">{header}</div>
              <div className={cn(
                'mt-1 whitespace-pre-wrap break-words',
                bodyRtl ? 'text-right text-base [direction:rtl]' : 'text-left [direction:ltr]'
              )}>
                {body || '—'}
              </div>
            </div>
          );
        }
        const rtl = hasHebrew(chunk);
        return (
          <div key={i} className={cn(
            'whitespace-pre-wrap break-words',
            rtl ? 'text-right text-base [direction:rtl]' : 'text-left [direction:ltr]'
          )}>
            {chunk}
          </div>
        );
      })}
    </div>
  );
}

export interface DetailGroup { title: string; fields: string[] }

const columnMoveBtnClass = 'min-w-[36px] cursor-pointer rounded-sm border border-border bg-muted px-2.5 py-1 text-[13px] text-foreground';

// Field→category assignment editor for a defect-detail form — lets a user
// hide fields entirely and reassign which group each shown field appears
// under, including creating/renaming/deleting groups outright. `storageKey`
// is per-screen so each defect-detail screen keeps its own independent
// customization (they don't share the same field set).
export function DetailGroupsDialog({
  allColumns, groups, defaultGroups, onApply, onClose,
}: {
  allColumns: { key: string; label: string }[];
  groups: DetailGroup[];
  defaultGroups: DetailGroup[];
  onApply: (groups: DetailGroup[]) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(groups.map(g => g.title));
  const [assignment, setAssignment] = useState<Record<string, string | null>>(() => {
    const map: Record<string, string | null> = {};
    allColumns.forEach(c => { map[c.key] = null; });
    groups.forEach(g => g.fields.forEach(k => { map[k] = g.title; }));
    return map;
  });
  const [newCategoryName, setNewCategoryName] = useState('');

  const resetToDefault = () => {
    setCategories(defaultGroups.map(g => g.title));
    setAssignment(() => {
      const map: Record<string, string | null> = {};
      allColumns.forEach(c => { map[c.key] = null; });
      defaultGroups.forEach(g => g.fields.forEach(k => { map[k] = g.title; }));
      return map;
    });
    setNewCategoryName('');
  };

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name || categories.includes(name)) return;
    setCategories(c => [...c, name]);
    setNewCategoryName('');
  };
  const renameCategory = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categories.includes(trimmed)) return;
    setCategories(c => c.map(x => x === oldName ? trimmed : x));
    setAssignment(a => {
      const next = { ...a };
      Object.keys(next).forEach(k => { if (next[k] === oldName) next[k] = trimmed; });
      return next;
    });
  };
  const removeCategory = (name: string) => {
    setCategories(c => c.filter(x => x !== name));
    setAssignment(a => {
      const next = { ...a };
      Object.keys(next).forEach(k => { if (next[k] === name) next[k] = null; });
      return next;
    });
  };

  const apply = () => {
    const result: DetailGroup[] = categories
      .map(title => ({ title, fields: allColumns.filter(c => assignment[c.key] === title).map(c => c.key) }))
      .filter(g => g.fields.length > 0);
    onApply(result);
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/50">
      <div onClick={e => e.stopPropagation()} className="flex max-h-[86vh] w-[640px] max-w-[94vw] flex-col rounded-lg bg-card p-5 shadow-[0_20px_48px_rgba(0,0,0,.25)] [direction:rtl]">
        <div className="mb-1 text-sm font-bold text-foreground">התאמת שדות וקטגוריות בטופס פרטי התקלה</div>
        <div className="mb-3.5 text-xs text-subtle-foreground">לכל שדה בחרו קטגוריה (או "הסתר") — ניתן גם להוסיף, לשנות שם, או למחוק קטגוריות.</div>

        <div className="mb-3.5 flex flex-wrap gap-1.5 border-b border-border pb-3.5">
          {categories.map(cat => (
            <div key={cat} className="flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-[3px]">
              <input
                defaultValue={cat}
                onBlur={e => renameCategory(cat, e.target.value)}
                className="border-none bg-transparent text-xs text-foreground"
                style={{ width: `${Math.max(cat.length, 4)}ch` }}
              />
              <button onClick={() => removeCategory(cat)} className="cursor-pointer border-none bg-transparent p-0 text-xs text-danger">✕</button>
            </div>
          ))}
          <div className="flex gap-1">
            <input
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
              placeholder="קטגוריה חדשה..."
              className="w-[110px] rounded-sm border border-border px-2 py-[3px] text-xs"
            />
            <button onClick={addCategory} className={cn(columnMoveBtnClass, 'px-2.5 py-0.5')}>+</button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {allColumns.map(c => (
            <div key={c.key} className="flex items-center justify-between gap-2.5 px-0.5 py-1">
              <span className="text-[13px] text-muted-foreground">{c.label}</span>
              <select
                value={assignment[c.key] ?? ''}
                onChange={e => setAssignment(a => ({ ...a, [c.key]: e.target.value || null }))}
                className="min-w-[150px] rounded-sm border border-border px-1.5 py-[3px] text-xs"
              >
                <option value="">— הסתר —</option>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
          <button onClick={resetToDefault} className="cursor-pointer rounded-md border border-border bg-transparent px-4 py-2 text-[13px] text-subtle-foreground">↺ איפוס לברירת מחדל</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="cursor-pointer rounded-md border border-border bg-muted px-5 py-2 text-[13px] text-muted-foreground">Cancel</button>
            <button onClick={apply} className="cursor-pointer rounded-md border-none bg-primary px-5 py-2 text-[13px] font-semibold text-white">OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DefectFieldChange {
  changeTime: string;
  changedBy: string;
  propertyName: string;
  oldValue: string;
  newValue: string;
}


// Change-history section for a defect-detail screen — fetches /qc/defect-
// field-history and renders a filterable table (מתי השתנה | מי שינה | שדה |
// ערך ישן | ערך חדש). Backed by QC's AUDIT_LOG/AUDIT_PROPERTIES tables (see
// DEFECT_FIELD_HISTORY_SQL in qc.service.ts) — AU_USER/AP_OLD_VALUE are
// unverified against any real instance beyond the mock fallback.
export function FieldChangeHistorySection({ defectId, token, defaultOpen = false }: { defectId: string; token: string; defaultOpen?: boolean }) {
  // Collapsed by default, and the fetch is deferred until first expand — this
  // section used to always fetch + render fully open, taking real screen
  // space and an API call most viewers never look at (spec confirmed
  // 2026-09-03: "את אזור ההיסטוריה יש לקפל"). `defaultOpen` is for when it's
  // rendered inside its own modal (2026-09-06) — there's nothing to collapse
  // into there, so it opens and fetches immediately.
  const [expanded, setExpanded] = useState(defaultOpen);
  const [fieldHistory, setFieldHistory] = useState<DefectFieldChange[] | null>(null);
  const [historyFieldFilter, setHistoryFieldFilter] = useState('');

  useEffect(() => {
    setFieldHistory(null);
    setHistoryFieldFilter('');
    setExpanded(defaultOpen);
  }, [defectId, token, defaultOpen]);

  useEffect(() => {
    if (!expanded || fieldHistory !== null) return;
    axios.get(`${API}/qc/defect-field-history`, { headers: { Authorization: `Bearer ${token}` }, params: { defectId } })
      .then(r => setFieldHistory(r.data))
      .catch(() => setFieldHistory([]));
  }, [expanded, fieldHistory, defectId, token]);

  return (
    <div className="border-t border-border pt-3">
      <div
        onClick={() => setExpanded(v => !v)}
        className={cn('flex cursor-pointer select-none items-center justify-between', expanded && 'mb-2')}
      >
        <div className="flex items-center gap-1.5 text-sm font-bold text-subtle-foreground">
          <span className={cn('inline-block transition-transform duration-150', expanded && 'rotate-90')}>▶</span>
          היסטוריית שינויים
        </div>
        {expanded && fieldHistory && fieldHistory.length > 0 && (
          <select
            value={historyFieldFilter}
            onClick={e => e.stopPropagation()}
            onChange={e => setHistoryFieldFilter(e.target.value)}
            className="rounded-sm border border-border px-2 py-1 text-[13px]"
          >
            <option value="">כל השדות</option>
            {Array.from(new Set(fieldHistory.map(h => h.propertyName))).sort().map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>
      {expanded && (
        !fieldHistory ? (
          <div className="p-4 text-center text-[13px] text-subtle-foreground">טוען...</div>
        ) : fieldHistory.length === 0 ? (
          <div className="p-4 text-center text-[13px] text-subtle-foreground">אין היסטוריית שינויים זמינה לתקלה זו</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-muted">
                  {['מתי השתנה', 'מי שינה', 'שדה', 'ערך ישן', 'ערך חדש'].map(h => (
                    <th key={h} className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-right font-semibold text-subtle-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fieldHistory
                  .filter(h => !historyFieldFilter || h.propertyName === historyFieldFilter)
                  .map((h, i) => {
                    const oldRtl = hasHebrew(h.oldValue);
                    const newRtl = hasHebrew(h.newValue);
                    return (
                      <tr key={i} className="border-b border-border">
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-left text-muted-foreground [direction:ltr]">{formatDateTime(h.changeTime)}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-left text-muted-foreground [direction:ltr]">{h.changedBy || '—'}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-foreground [direction:ltr]">{h.propertyName || '—'}</td>
                        <td className={cn('px-2.5 py-1.5 text-muted-foreground', oldRtl ? 'text-right [direction:rtl]' : 'text-left [direction:ltr]')}>{h.oldValue || '—'}</td>
                        <td className={cn('px-2.5 py-1.5 text-muted-foreground', newRtl ? 'text-right [direction:rtl]' : 'text-left [direction:ltr]')}>{h.newValue || '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ── Attachments ──────────────────────────────────────────────────────────
// Defect-detail "Attachments" section (spec confirmed 2026-09-03) — pulls
// the file list from QC via the per-user REST session (qc-rest.service.ts),
// never stores a local copy. Preview/Download both fetch the file as a blob
// through our own backend (which relays it from QC) rather than linking
// directly to QC, since QC's session cookie can't be handed to the browser.
// The backend endpoint/XML-tag-name assumptions here are UNVERIFIED against
// this real QC instance — shipped now per explicit instruction to correct
// after seeing real behavior, not before.
interface DefectAttachment {
  name: string; fileSize: number; owner: string; uploadDate: string; description: string;
}

const PREVIEWABLE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'log', 'csv']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif']);
const TEXT_EXT = new Set(['txt', 'log', 'csv']);

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreviewModal({ defectId, fileName, token, onClose }: { defectId: string; fileName: string; token: string; onClose: () => void }) {
  const [content, setContent] = useState<{ kind: 'image' | 'pdf' | 'text'; url?: string; text?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const ext = fileExt(fileName);
    const isText = TEXT_EXT.has(ext);
    axios.get(`${API}/qc/defect/${encodeURIComponent(defectId)}/attachments/${encodeURIComponent(fileName)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: isText ? 'text' : 'blob',
    }).then(res => {
      if (isText) {
        setContent({ kind: 'text', text: String(res.data) });
      } else {
        objectUrl = URL.createObjectURL(res.data as Blob);
        setContent({ kind: IMAGE_EXT.has(ext) ? 'image' : 'pdf', url: objectUrl });
      }
    }).catch(() => setError('שגיאה בטעינת הקובץ מ-QC'));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [defectId, fileName, token]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 p-6">
      <div onClick={e => e.stopPropagation()} className="flex h-[85vh] w-[90vw] max-w-[900px] flex-col rounded-lg bg-card p-4 shadow-[0_20px_48px_rgba(0,0,0,.3)]">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="text-left text-sm font-bold text-foreground [direction:ltr]">{fileName}</div>
          <button onClick={onClose} className="cursor-pointer border-none bg-transparent text-lg text-subtle-foreground">✕</button>
        </div>
        <div className={cn('flex flex-1 justify-center overflow-auto rounded-md bg-muted', content?.kind === 'text' ? 'items-stretch' : 'items-center')}>
          {error && <div className="p-5 text-[13px] text-danger">{error}</div>}
          {!error && !content && <div className="p-5 text-[13px] text-subtle-foreground">טוען...</div>}
          {content?.kind === 'image' && <img src={content.url} alt={fileName} className="max-h-full max-w-full object-contain" />}
          {content?.kind === 'pdf' && <iframe src={content.url} title={fileName} className="h-full w-full border-none" />}
          {content?.kind === 'text' && (
            <pre className="m-0 w-full whitespace-pre-wrap break-words p-3.5 text-left text-xs text-foreground [direction:ltr]">
              {content.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function AttachmentsSection({ defectId, token }: { defectId: string; token: string }) {
  const [attachments, setAttachments] = useState<DefectAttachment[] | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  useEffect(() => {
    setAttachments(null);
    axios.get(`${API}/qc/defect/${encodeURIComponent(defectId)}/attachments`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setAttachments(r.data ?? []))
      .catch(() => setAttachments([]));
  }, [defectId, token]);

  const download = async (fileName: string) => {
    try {
      const res = await axios.get(`${API}/qc/defect/${encodeURIComponent(defectId)}/attachments/${encodeURIComponent(fileName)}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('שגיאה בהורדת הקובץ מ-QC');
    }
  };

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 text-sm font-bold text-subtle-foreground">
        קבצים מצורפים{attachments && attachments.length > 0 ? ` (${attachments.length})` : ''}
      </div>
      {attachments === null ? (
        <div className="p-4 text-center text-[13px] text-subtle-foreground">טוען...</div>
      ) : attachments.length === 0 ? (
        <div className="p-4 text-center text-[13px] text-subtle-foreground">אין קבצים מצורפים</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map(a => {
            const ext = fileExt(a.name);
            const canPreview = PREVIEWABLE_EXT.has(ext);
            return (
              <div key={a.name} className="flex items-center gap-2.5 rounded-md bg-muted px-2.5 py-[7px]">
                <span className="shrink-0 text-base">📎</span>
                <div className="min-w-0 flex-1 text-left [direction:ltr]">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-foreground">{a.name}</div>
                  <div className="mt-0.5 text-[11px] text-subtle-foreground">
                    {ext.toUpperCase() || '—'} · {formatFileSize(a.fileSize)}{a.uploadDate ? ` · ${formatDateTime(a.uploadDate)}` : ''}{a.owner ? ` · ${a.owner}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {canPreview && (
                    <button onClick={() => setPreviewFile(a.name)} title="צפייה ישירה" className="cursor-pointer rounded-sm border border-border bg-transparent px-2 py-1 text-[13px]">👁️</button>
                  )}
                  <button onClick={() => download(a.name)} title="הורדה" className="cursor-pointer rounded-sm border border-border bg-transparent px-2 py-1 text-[13px]">⬇️</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {previewFile && (
        <AttachmentPreviewModal defectId={defectId} fileName={previewFile} token={token} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
}

// ── Resizable columns ────────────────────────────────────────────────────
// Drag-to-resize column widths for the app's defect tables (TARGET table,
// DefectDrilldownModal, OpenProdDefectsView) — none of them had any width
// control before this. Persisted per-user per-table via localStorage
// (`storageKey` is table-specific so each table keeps its own widths).
// RTL note: these tables are direction:'rtl' and the column-key array is in
// right-to-left reading order (first key = rightmost column), so the
// boundary between column N and column N+1 sits at column N's LEFT edge —
// the resize handle lives there, and dragging left (negative clientX delta)
// grows the column while dragging right shrinks it (spec confirmed
// 2026-08-31).
const MIN_COLUMN_WIDTH = 60;

export function useColumnWidths(storageKey: string, defaultWidth = 140) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return {};
  });
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const getWidth = useCallback((key: string) => widths[key] ?? defaultWidth, [widths, defaultWidth]);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthsRef.current[key] ?? defaultWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth - delta));
      setWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(storageKey, JSON.stringify(widthsRef.current)); } catch { /* ignore quota errors */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [storageKey, defaultWidth]);

  return { getWidth, startResize };
}

// Thin drag handle on a header cell's left edge (see RTL note above). The
// `<th>` it's placed in needs `position: 'relative'`.
export function ColumnResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, bottom: 0, left: '-3px', width: '6px',
        cursor: 'col-resize', zIndex: 1,
      }}
    />
  );
}

// ── Per-column filtering — fixed-value columns vs free-text columns ─────
// Fields whose values come from a small, fixed set (Severity, Status,
// Reproducible Y/N, team names, ...) get a multi-select checklist; genuinely
// free-text fields (Summary, Description, Notes, ...) keep a substring
// search box. "Fixed" isn't hand-classified per field (that would mean
// maintaining a list across ~60+ fields spanning 3 different tables with
// overlapping-but-not-identical sets) — it's detected from the actual data:
// a column counts as fixed/enum when it has few distinct non-empty values
// (≤ENUM_MAX_DISTINCT) AND fewer distinct values than rows (so a column that
// only LOOKS small because there are few rows doesn't get misclassified).
// Session-only (not persisted), same as sort state in these tables (spec
// corrected 2026-08-31).
const ENUM_MAX_DISTINCT = 12;

// Explicit overrides for fields where the dynamic distinct-count heuristic
// can get the wrong answer for a given dataset — e.g. "סוג תקלה" (Bug Type)
// exceeded ENUM_MAX_DISTINCT in a real release so it fell back to free-text
// search even though it's clearly a fixed field; CR/HBR reference numbers
// happened to have few distinct values in a small table so they were
// misclassified as enum even though they're really a free-text reference
// field. Covers the full field vocabulary shared across all 3 tables
// (VersionOverview's TARGET_DEFECT_COLUMNS, DefectDrilldownModal's
// ALL_COLUMNS, openProdDefectsFields' TABLE_COLUMN_FIELDS/DETAIL_FIELDS —
// same key names except OpenProdDefectsView's own table using `bugType`
// where the others use `defectType`). Only semantically unambiguous fields
// are forced either way; genuinely data-dependent ones (person names,
// module/component pickers, business-process names) are left to the
// dynamic heuristic since there's no single right answer for those (spec
// corrected 2026-08-31).
const FORCE_ENUM_FIELDS = new Set([
  // Y/N flags — always exactly 2 possible values.
  'reproducible', 'reopenYn', 'fixedInProd', 'willBeTestAtGoLive', 'forRegressionTest',
  'toBeTestedOnProd', 'targetScopeApproved', 'foundByAutomation',
  // Fixed QC dropdown fields whose real vocabulary can exceed ENUM_MAX_DISTINCT
  // in production data even though they're conceptually a closed set.
  'status', 'statusAtMonth', 'currentStatus', 'severity', 'priority', 'testPhase',
  'defectType', 'bugType', 'fixType', 'environment', 'vendorStatus', 'supportStatus',
  'crStatus', 'category', 'itemType', 'platform', 'influence', 'secondaryPriority',
  'impact', 'deploymentCategory', 'targetType', 'reason', 'deploymentReason', 'productionReason',
]);
const FORCE_TEXT_FIELDS = new Set([
  // IDs/reference numbers — unique or near-unique by nature, never useful as a checklist.
  'id', 'defectId', 'crReferenceNumber', 'crHbrNumberReference', 'supportReferenceNumber', 'dropNumber',
  // Free-form prose.
  'title', 'subject', 'area',
  // Dates/times/durations — inherently high-cardinality; a small dataset
  // coincidentally having few distinct values doesn't make a date field a
  // sensible checklist.
  'detectedOnDate', 'detectedDate', 'discoveryDate', 'estimatedFixTime', 'actualFixTime',
  'estimateFixTime', 'fixedUntil', 'responseDate', 'modified', 'deploymentDateProd',
  'detectedInRelease', 'detectedInCycle', 'targetRelease', 'targetCycle',
]);

export function useColumnFilters(allRows: Record<string, unknown>[] | null | undefined, columnKeys: string[]) {
  const rows = allRows ?? [];
  const keysSignature = columnKeys.join('|');
  const distinctMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const key of keysSignature ? keysSignature.split('|') : []) {
      const set = new Set<string>();
      for (const r of rows) {
        const v = r[key];
        if (v !== null && v !== undefined && v !== '') set.add(String(v));
      }
      map[key] = Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, keysSignature]);

  const isEnum = useCallback((key: string) => {
    const distinct = distinctMap[key];
    if (!distinct || distinct.length === 0) return false;
    if (FORCE_TEXT_FIELDS.has(key)) return false;
    if (FORCE_ENUM_FIELDS.has(key)) return true;
    return distinct.length <= ENUM_MAX_DISTINCT && distinct.length < rows.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distinctMap, rows.length]);

  const [textTerms, setTextTerms] = useState<Record<string, string>>({});
  const [enumSel, setEnumSel] = useState<Record<string, Set<string>>>({});

  const setTextTerm = useCallback((key: string, value: string) => {
    setTextTerms(t => (value ? { ...t, [key]: value } : (() => { const n = { ...t }; delete n[key]; return n; })()));
  }, []);
  const toggleEnumValue = useCallback((key: string, value: string) => {
    setEnumSel(s => {
      const next = { ...s };
      const set = new Set(next[key] ?? []);
      if (set.has(value)) set.delete(value); else set.add(value);
      if (set.size === 0) delete next[key]; else next[key] = set;
      return next;
    });
  }, []);

  const matches = useCallback((row: Record<string, unknown>) => {
    for (const [key, term] of Object.entries(textTerms)) {
      if (!String(row[key] ?? '').toLowerCase().includes(term.toLowerCase())) return false;
    }
    for (const [key, set] of Object.entries(enumSel)) {
      if (set.size > 0 && !set.has(String(row[key] ?? ''))) return false;
    }
    return true;
  }, [textTerms, enumSel]);

  return {
    isEnum,
    distinctValues: (key: string) => distinctMap[key] ?? [],
    textTerm: (key: string) => textTerms[key] ?? '',
    setTextTerm,
    enumSelected: (key: string) => enumSel[key] ?? new Set<string>(),
    toggleEnumValue,
    matches,
  };
}

export type ColumnFiltersApi = ReturnType<typeof useColumnFilters>;

export function EnumFilterButton({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: Set<string>; onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const buttonLabel = selected.size === 0 ? 'הכל' : `${selected.size} נבחרו`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={cn(
          'box-border w-full min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border bg-background px-1.5 py-[3px] text-right text-xs',
          selected.size > 0 ? 'border-primary text-primary' : 'border-border text-muted-foreground'
        )}
      >
        {buttonLabel} ▾
      </button>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-full z-20 mt-0.5 max-h-[240px] min-w-[160px] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-[0_8px_24px_rgba(0,0,0,.18)]"
        >
          {options.map(opt => (
            <label key={opt} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-1.5 py-1 text-xs text-foreground">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => onToggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColumnFilterRow({
  columns, getWidth, filters,
}: {
  columns: { key: string; label: string }[];
  getWidth: (key: string) => number;
  filters: ColumnFiltersApi;
}) {
  return (
    <tr className="bg-card">
      {columns.map(c => (
        <th key={c.key} style={{ width: getWidth(c.key) }} className="border-b border-border px-1.5 py-1">
          {filters.isEnum(c.key) ? (
            <EnumFilterButton
              label={c.label}
              options={filters.distinctValues(c.key)}
              selected={filters.enumSelected(c.key)}
              onToggle={value => filters.toggleEnumValue(c.key, value)}
            />
          ) : (
            <input
              value={filters.textTerm(c.key)}
              onChange={e => filters.setTextTerm(c.key, e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="חיפוש..."
              // min-w-0 — <input> elements default to an intrinsic min-width
              // (~150-190px in Chrome) that ignores w-full and a narrower
              // parent <th>; without overriding it, this search box silently
              // became the real floor on how far a column could shrink,
              // regardless of the resize handle's own (much smaller)
              // MIN_COLUMN_WIDTH (found 2026-09-03).
              className="box-border w-full min-w-0 rounded-sm border border-border bg-background px-1.5 py-[3px] text-xs text-foreground"
            />
          )}
        </th>
      ))}
    </tr>
  );
}

// ── Column picker — one mechanism for every defect table ────────────────
// Dual-listbox "Available / Visible" picker with move (›/»/‹/«) and reorder
// (↑/↓) controls. Used to be reimplemented near-identically in
// DefectDrilldownModal, VersionOverview and IncidentsView (each with its own
// column-key type) — centralized here so every defect table's "⚙ בחירת
// עמודות" opens the exact same dialog (feedback 2026-09-10: "החל את מנגנון
// בחירת העמודות ... בכל טבלאות התקלות"). Generic over the column-key type
// since each table's field vocabulary is genuinely different. Reuses
// columnMoveBtnClass already defined above for DetailGroupsDialog.
export function SelectColumnsDialog<K extends string>({
  allColumns, visibleKeys, onApply, onClose,
}: {
  allColumns: { key: K; label: string }[];
  visibleKeys: K[];
  onApply: (keys: K[]) => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(
    visibleKeys.map(k => allColumns.find(c => c.key === k)).filter((c): c is { key: K; label: string } => !!c)
  );
  const [available, setAvailable] = useState(allColumns.filter(c => !visibleKeys.includes(c.key)));
  const [selAvailable, setSelAvailable] = useState<Set<K>>(new Set());
  const [selVisible, setSelVisible] = useState<Set<K>>(new Set());

  const toggle = (set: Set<K>, key: K, setFn: (s: Set<K>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFn(next);
  };

  const moveToVisible = () => {
    if (selAvailable.size === 0) return;
    setVisible(v => [...v, ...available.filter(c => selAvailable.has(c.key))]);
    setAvailable(a => a.filter(c => !selAvailable.has(c.key)));
    setSelAvailable(new Set());
  };
  const moveToAvailable = () => {
    if (selVisible.size === 0) return;
    setAvailable(a => [...a, ...visible.filter(c => selVisible.has(c.key))]);
    setVisible(v => v.filter(c => !selVisible.has(c.key)));
    setSelVisible(new Set());
  };
  const moveAllToVisible = () => { setVisible(v => [...v, ...available]); setAvailable([]); setSelAvailable(new Set()); };
  const moveAllToAvailable = () => { setAvailable(a => [...a, ...visible]); setVisible([]); setSelVisible(new Set()); };

  const reorder = (dir: -1 | 1) => {
    if (selVisible.size !== 1) return;
    const key = Array.from(selVisible)[0];
    const idx = visible.findIndex(c => c.key === key);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= visible.length) return;
    const next = [...visible];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setVisible(next);
  };

  const listBoxClass = 'h-[280px] overflow-y-auto rounded-sm border border-border bg-muted';
  const itemClass = (selected: boolean) =>
    cn('cursor-pointer px-2 py-1 text-[13px] text-foreground', selected ? 'bg-primary/10' : 'bg-transparent');

  return (
    <div onClick={onClose} className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50">
      <div onClick={e => e.stopPropagation()} className="w-[660px] max-w-[94vw] rounded-lg bg-card p-5 shadow-[0_20px_48px_rgba(0,0,0,.25)]">
        <div className="mb-3.5 text-right text-sm font-bold text-foreground">בחירת עמודות</div>
        <div className="flex gap-2.5 [direction:ltr]">
          <div className="flex-1">
            <div className="mb-1 text-xs text-subtle-foreground">Available Columns:</div>
            <div className={listBoxClass}>
              {available.map(c => (
                <div key={c.key} onClick={() => toggle(selAvailable, c.key, setSelAvailable)} className={itemClass(selAvailable.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center gap-1.5">
            <button onClick={moveToVisible} className={columnMoveBtnClass}>&gt;</button>
            <button onClick={moveAllToVisible} className={columnMoveBtnClass}>&gt;&gt;</button>
            <button onClick={moveToAvailable} className={columnMoveBtnClass}>&lt;</button>
            <button onClick={moveAllToAvailable} className={columnMoveBtnClass}>&lt;&lt;</button>
          </div>
          <div className="flex-1">
            <div className="mb-1 flex justify-between">
              <span className="text-xs text-subtle-foreground">Visible Columns:</span>
              <div className="flex gap-1">
                <button onClick={() => reorder(-1)} className={cn(columnMoveBtnClass, 'px-2 py-0.5')}>↑</button>
                <button onClick={() => reorder(1)} className={cn(columnMoveBtnClass, 'px-2 py-0.5')}>↓</button>
              </div>
            </div>
            <div className={listBoxClass}>
              {visible.map(c => (
                <div key={c.key} onClick={() => toggle(selVisible, c.key, setSelVisible)} className={itemClass(selVisible.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="cursor-pointer rounded-md border border-border bg-muted px-5 py-2 text-[13px] text-muted-foreground">ביטול</button>
          <button onClick={() => onApply(visible.map(c => c.key))} className="cursor-pointer rounded-md border-none bg-primary px-5 py-2 text-[13px] font-semibold text-white">אישור</button>
        </div>
      </div>
    </div>
  );
}
