import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';
import { DateField } from './DatePicker';
import { C, SHADOW, WEIGHT } from '../theme';
import { cn } from '../lib/utils';
import { Button } from './ui';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDateTime } from '../utils/dateFormat';
import { DefectIdBadge } from './shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_LABELS: Record<number, string> = {
  1: 'שלב 1 — בוקר לפני גרסה',
  2: 'שלב 2 — HOTNET',
  3: 'שלב 3 — HOT',
  4: 'שלב 4 — בוקר לאחר גרסה',
};

const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: C.infoBg,    color: C.info },
  2: { bg: C.successBg, color: C.success },
  3: { bg: C.warningBg, color: C.warning },
  4: { bg: C.bgWaiting, color: C.statusWaiting },
};

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];
const FREE_KEY = '__FREE__';

const TEAM_APPS: Record<string, string[]> = {
  'NETC Team':               ['BILI', 'IRB'],
  'CRM Dev Team':            ['CRM', 'TOP', 'CONNECT'],
  'EAI Team':                ['OSB', 'DP', 'MEDIATION', 'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA', 'PROVISIONING OTT', 'PROVISIONING TEL'],
  'Web Dev Team':            ['WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT'],
  'NC Team':                 ['NC'],
  'ERP Team':                ['ERP'],
  'Operations Team':         ['CREDIT GUARD', 'ARCHIVE', 'PRINT BOSS', 'BEERI'],
  'Billing Operations Team': ['CREDIT GUARD', 'ARCHIVE', 'PRINT BOSS', 'BEERI'],
  'SHOB Team':               ['NIFI', 'CAWA'],
  'IVR Team':                ['IVR'],
  'OSS Team':                ['REMEDY', 'ZOO'],
  // Teams not listed → show all APPS (fallback handled below)
};

// ── טופס CR מובנה (exception-first) — אפיון 2026-07-17 ─────────────────────────
const GOLIVE = C.moduleGoLive; // מודול "עלייה לאוויר" — הגוון הייעודי מהעיצוב שאושר
const CHANGE_TYPES = ['קוד', 'פרמטר', 'הרשאה', 'Setup', 'ממשק', 'תהליך מתוזמן / Job', 'סקריפט', 'הסבת נתונים', 'קובץ'];
const PREREQUISITE_OPTIONS = ['אישור מנהל', 'גיבוי מוקדם', 'חלון תחזוקה', 'תיאום עם צוות חיצוני'];
// Single canonical action-type vocabulary for this file — shared by the CrPlanAction
// form, the Task Wizard, and the derived-task ("משימות נגזרות") edit form. Used to be
// two separate lists; a CrPlanAction's actionType flows automatically into its derived
// TaskProposal (derivedProposalId), so a value only known to one list rendered as a
// blank, unselected dropdown the moment the other form tried to edit it.
const ACTION_TYPE_OPTIONS = [
  'הרצת סקריפט', 'הסבת נתונים', 'טעינת קובץ', 'יצירת תיקייה', 'עדכון Crontab',
  'עצירת Job', 'הפעלת Job', 'פתיחת פרמטר', 'פתיחת הרשאה', 'בדיקה ידנית', 'פעולת תפעול',
  'הגדרת פרמטרים', 'הגדרת הרשאות', 'עצירת תהליך מתוזמן', 'החזרת תהליך מתוזמן',
  'הטמעת קוד', 'בדיקת תקינות', 'הגדרת תצורה', 'פעולה ידנית', 'פתיחת תקשורת FW', 'אחר',
];
const MONITORING_TYPES = ['ממשק', 'טבלה', 'Job', 'דוח', 'תור', 'קובץ', 'אחר'];
const ROLLBACK_TYPES = ['כיבוי פרמטר', 'הסרת הרשאה', 'עצירת Job', 'החזרת קובץ', 'חזרה מגיבוי', 'לא נדרש — תיקון ידני', 'אחר'];

// Task Wizard — step 1 type grid. Six types map onto the existing CrPlanAction
// actionType taxonomy (same data shape as the flat form); Monitoring routes to
// the separate CrPlanMonitoringPoint model. Rollback is deliberately excluded —
// it's a single field on CrPlan, not a repeatable list, so it stays on the
// existing dedicated section instead of becoming a wizard task type.
type WizardTaskType = 'Parameter' | 'Permission' | 'Script' | 'Setup' | 'Firewall' | 'Validation' | 'Monitoring' | 'Other';
const WIZARD_TYPES: { type: WizardTaskType; icon: string; label: string; actionType?: string }[] = [
  { type: 'Parameter',  icon: '⚙',  label: 'פרמטר',  actionType: 'פתיחת פרמטר' },
  { type: 'Permission', icon: '🔑', label: 'הרשאה',  actionType: 'פתיחת הרשאה' },
  { type: 'Script',     icon: '📜', label: 'סקריפט', actionType: 'הרצת סקריפט' },
  { type: 'Setup',      icon: '📁', label: 'הקמה',   actionType: 'יצירת תיקייה' },
  { type: 'Firewall',   icon: '🧱', label: 'תקשורת FW', actionType: 'פתיחת תקשורת FW' },
  { type: 'Validation', icon: '✔',  label: 'בדיקה',  actionType: 'בדיקה ידנית' },
  { type: 'Monitoring', icon: '👁', label: 'בקרה' },
  { type: 'Other',      icon: '•••', label: 'אחר',    actionType: 'אחר' },
];
const DURATION_CHIPS = [1, 5, 10, 15, 30, 60];

// Timeline Planning — day-part buckets, mapped onto the real 4-value phase
// field (1=before, 2=HOTNET, 3=HOT, 4=after). Visual grouping only — no new
// data, so there's no 5th "release day morning" bucket some design mockups
// show, since the schema has nothing to back it.
const PHASE_BUCKETS: { letter: string; phase: number; title: string; meta: string }[] = [
  { letter: 'A', phase: 1, title: 'הכנות לפני יום הגרסה', meta: 'הרשאות, קבצים, Setup מקדים' },
  { letter: 'C', phase: 2, title: 'ליל הגרסה — שלב 2 (HOTNET)', meta: 'עדכוני פרמטרים, סקריפטים, הרשאות' },
  { letter: 'D', phase: 3, title: 'ליל הגרסה — שלב 3 (HOT)', meta: 'פעולות ייחודיות לאחר עליית הקוד' },
  { letter: 'E', phase: 4, title: 'בוקר שלאחר הגרסה', meta: 'מעקב ובקרה תפעולית' },
];
// One icon+color per real action type — a rough mapping onto the mockup's
// container categories (Setup/Parameters/Permissions/Scripts/Validation...).
const ACTION_TYPE_ICON: Record<string, { icon: string; bg: string; color: string }> = {
  'הרצת סקריפט':    { icon: '📄', color: C.brand,   bg: C.brandDim },
  'הסבת נתונים':    { icon: '🔄', color: C.info,    bg: C.infoBg },
  'טעינת קובץ':     { icon: '📁', color: C.info,    bg: C.infoBg },
  'יצירת תיקייה':   { icon: '📁', color: C.info,    bg: C.infoBg },
  'עדכון Crontab':  { icon: '⚙️', color: C.warning, bg: C.warningBg },
  'עצירת Job':      { icon: '⏸️', color: C.warning, bg: C.warningBg },
  'הפעלת Job':      { icon: '▶️', color: C.warning, bg: C.warningBg },
  'פתיחת פרמטר':    { icon: '⚙️', color: C.warning, bg: C.warningBg },
  'פתיחת הרשאה':    { icon: '🔑', color: C.success, bg: C.successBg },
  'בדיקה ידנית':    { icon: '✔️', color: C.success, bg: C.successBg },
  'פעולת תפעול':    { icon: '🛠️', color: C.textMuted, bg: C.bgNested },
  'פתיחת תקשורת FW': { icon: '🧱', color: C.danger,   bg: C.dangerBg },
  'אחר':            { icon: '⋯', color: C.textMuted, bg: C.bgNested },
};

interface CrPlanAction {
  id?: string;
  actionType: string;
  description: string;
  phase: number;
  subPhaseId?: string;
  system?: string;
  estimatedMins?: number;
  dependsOnTaskId?: string;
  dependencyNote?: string;
  ownerName?: string;
  // TargetCrDefect.id — set when this action was derived from a TARGET
  // defect's "requires special implementation" checkbox, so the defect row
  // that created it can be found again. Absent on a manually-added action.
  sourceDefectId?: string;
}
interface CrPlanMonitoringPoint {
  id?: string;
  type: string;
  name: string;
  note?: string;
  phase: number;
  assignedTeamId?: string;
  assignedUserName?: string;
}

interface Proposal {
  id: string;
  teamId: string;
  title: string;
  app?: string;
  actionType?: string;
  estimatedMins?: number;
  crNumber?: string;
  crLabel?: string;
  notes?: string;
  assignedUserName?: string;
  phase: number;
  status: 'DRAFT' | 'READY';
  usedInTaskId?: string;
}

interface CrPlanData {
  id: string;
  crNumber: string;
  crLabel?: string;
  crManager?: string;
  crDescription?: string;
  crType?: string;
  riskLevel?: string;
  systems?: string[];
  workPlan?: string;
  scripts?: string;
  runTimes?: string;
  rollbackPlan?: string;
  gradualRollout: boolean;
  gradualDetails?: string;
  activationDate?: string;
  nightTestingNotes?: string;
  morningMonitoring?: string;
  notNeededForPlan: boolean;
  crDeps: { id: string; dependsOnCr: string; note?: string }[];
  submissionStatus?: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
  returnReason?: string;
  // ── טופס CR מובנה ──
  gateAnswered: boolean;
  changeTypes: string[];
  prerequisites: string[];
  prerequisitesNote?: string;
  nightTestNeeded: boolean;
  nextDayTestNeeded: boolean;
  nextDayTestNotes?: string;
  rollbackType?: string;
  actions: (CrPlanAction & { id: string })[];
  monitoringPoints: (CrPlanMonitoringPoint & { id: string })[];
}

interface CrPlanForm {
  crType: string;
  riskLevel: string;
  systems: string[];
  workPlan: string;
  scripts: string;
  runTimes: string;
  rollbackPlan: string;
  gradualRollout: boolean;
  gradualDetails: string;
  activationDate: string;
  nightTestingNotes: string;
  morningMonitoring: string;
  dependsOnCrs: string[];
  dependencyNotes: Record<string, string>;
  // ── טופס CR מובנה ──
  gateAnswered: boolean;
  changeTypes: string[];
  prerequisites: string[];
  prerequisitesNote: string;
  nightTestNeeded: boolean;
  nextDayTestNeeded: boolean;
  nextDayTestNotes: string;
  rollbackType: string;
  actions: CrPlanAction[];
  monitoringPoints: CrPlanMonitoringPoint[];
}

const emptyCrPlanForm = (): CrPlanForm => ({
  crType: 'פיתוח חדש',
  riskLevel: '',
  systems: [],
  workPlan: '',
  scripts: '',
  runTimes: '',
  rollbackPlan: '',
  gradualRollout: false,
  gradualDetails: '',
  activationDate: '',
  nightTestingNotes: '',
  morningMonitoring: '',
  dependsOnCrs: [],
  dependencyNotes: {},
  gateAnswered: false,
  changeTypes: [],
  prerequisites: [],
  prerequisitesNote: '',
  nightTestNeeded: false,
  nextDayTestNeeded: false,
  nextDayTestNotes: '',
  rollbackType: '',
  actions: [],
  monitoringPoints: [],
});

// Builds editable form state from a saved CrPlan — used both after fetching the
// version's plans and right after a save/submit response, so ids assigned by the
// server (needed to keep CrPlanAction rows stable across saves) always flow back
// into local state instead of being silently dropped.
const planToForm = (p: CrPlanData): CrPlanForm => {
  const dependencyNotes: Record<string, string> = {};
  for (const d of p.crDeps) if (d.note) dependencyNotes[d.dependsOnCr] = d.note;
  return {
    crType: p.crType ?? 'פיתוח חדש',
    riskLevel: p.riskLevel ?? '',
    systems: Array.from(new Set((p.systems ?? []).filter(Boolean))),
    workPlan: p.workPlan ?? '',
    scripts: p.scripts ?? '',
    runTimes: p.runTimes ?? '',
    rollbackPlan: p.rollbackPlan ?? '',
    gradualRollout: p.gradualRollout,
    gradualDetails: p.gradualDetails ?? '',
    activationDate: p.activationDate ? p.activationDate.slice(0, 10) : '',
    nightTestingNotes: p.nightTestingNotes ?? '',
    morningMonitoring: p.morningMonitoring ?? '',
    dependsOnCrs: p.crDeps.map(d => d.dependsOnCr),
    dependencyNotes,
    gateAnswered: p.gateAnswered ?? false,
    changeTypes: p.changeTypes ?? [],
    prerequisites: p.prerequisites ?? [],
    prerequisitesNote: p.prerequisitesNote ?? '',
    nightTestNeeded: p.nightTestNeeded ?? false,
    nextDayTestNeeded: p.nextDayTestNeeded ?? false,
    nextDayTestNotes: p.nextDayTestNotes ?? '',
    rollbackType: p.rollbackType ?? '',
    actions: (p.actions ?? []).map(a => ({ ...a })),
    monitoringPoints: (p.monitoringPoints ?? []).map(m => ({ ...m })),
  };
};

interface CrItem { id: string; label: string; crManager?: string; crDescription?: string; }
interface User { id: string; fullName: string; }
interface TeamVisibilityRow {
  teamId: string; teamName: string; isMine: boolean;
  submissionStatus: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' | null;
  notNeededForPlan: boolean; gateAnswered: boolean; started: boolean;
}
interface TeamPlanPreview {
  teamName: string; crLabel: string | null; notNeededForPlan: boolean;
  submittedAt: string | null; submittedByName: string | null;
  actions: { actionType: string; description: string; phase: number; system: string | null; estimatedMins: number | null; ownerName: string | null }[];
  monitoringPoints: { type: string; name: string; note: string | null; phase: number; assignedUserName: string | null }[];
  nightTestNeeded: boolean; nextDayTestNeeded: boolean;
  rollbackType: string | null; rollbackPlan: string | null;
}

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  teamIdOverride?: string;
  teamNameOverride?: string;
  reviewMeetingTime?: string;
  isManager?: boolean;
}

const emptyForm = {
  title: '',
  app: '',
  actionType: '',
  estimatedMins: '',
  crNumber: '',
  crLabel: '',
  isFree: false,
  notes: '',
  assignedUserName: '',
  phase: 1 as number,
  subPhaseId: '',
  responsibleTeamId: '',
};

const labelClass = 'mb-1 block text-sm font-semibold text-muted-foreground';
// Base input look shared by the proposal form's fields — `invalid` swaps the
// border to danger red (the previous per-field validation highlight), `extra`
// carries any remaining one-off overrides (background, height, ...).
const inputClass = (invalid?: boolean, extra?: string) => cn(
  'w-full box-border rounded-md border bg-card px-3 py-2.5 text-[15px] text-foreground',
  invalid ? 'border-danger' : 'border-border',
  extra,
);

// ── Task Wizard — guided step-by-step "Add Task" modal ──────────────────────
type SubPhaseOpt = { id: string; name: string; phaseName: string; phaseOrderIndex: number };
type WizardData = Partial<CrPlanAction & CrPlanMonitoringPoint>;
interface WizardStep {
  key: string;
  label: string;
  summary: (d: WizardData) => string;
  render: (d: WizardData, set: (patch: WizardData) => void) => React.ReactNode;
}

const wizChipClass = 'cursor-pointer rounded-full border px-3 py-[5px] text-[11.5px] font-semibold';
const wizChipStyle = (sel: boolean): React.CSSProperties => ({
  borderColor: sel ? GOLIVE : C.borderEm,
  background: sel ? `${GOLIVE}1c` : C.bgCard,
  color: sel ? GOLIVE : C.textSecondary,
});
const wizFieldClass = 'w-full box-border rounded-sm border border-border bg-card px-3 py-[9px] text-[13px] text-foreground';

function descriptionStep(label = 'תיאור המשימה', placeholder = 'תאר את הפעולה שיש לבצע...'): WizardStep {
  return {
    key: 'description', label,
    summary: d => d.description || '',
    render: (d, set) => (
      <textarea autoFocus value={d.description || ''} onChange={e => set({ description: e.target.value })}
        placeholder={placeholder} className={cn(wizFieldClass, 'min-h-[72px] resize-y')} />
    ),
  };
}
function systemStep(teamAppList: string[]): WizardStep {
  return {
    key: 'system', label: 'מערכת',
    summary: d => d.system || '',
    render: (d, set) => (
      <select autoFocus value={d.system || ''} onChange={e => set({ system: e.target.value || undefined })} className={wizFieldClass}>
        <option value="">— בחר מערכת —</option>
        {teamAppList.map(app => <option key={app} value={app}>{app}</option>)}
      </select>
    ),
  };
}
function phaseStep(label: string, phaseOptions: number[], phaseLabels: Record<number, string>, subPhaseOpts: SubPhaseOpt[]): WizardStep {
  return {
    key: 'phase', label,
    summary: d => d.phase != null ? (phaseLabels[d.phase]?.split(' — ')[1] || phaseLabels[d.phase] || `שלב ${d.phase}`) : '',
    render: (d, set) => (
      <div>
        <div className="mb-[10px] flex flex-wrap gap-[6px]">
          {phaseOptions.map(ph => {
            const fullLabel = phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`;
            const shortLabel = fullLabel.split(' — ')[1] || fullLabel;
            return (
              <span key={ph} title={fullLabel} onClick={() => set({ phase: ph, subPhaseId: '' })} className={wizChipClass} style={wizChipStyle(d.phase === ph)}>
                {shortLabel}
              </span>
            );
          })}
        </div>
        {d.phase != null && subPhaseOpts.filter(sp => sp.phaseOrderIndex === d.phase).length > 0 && (
          <select value={d.subPhaseId || ''} onChange={e => set({ subPhaseId: e.target.value })} className={wizFieldClass}>
            <option value="">תת-שלב מדוייק — לא נבחר (ישובץ בתחילת השלב)</option>
            {subPhaseOpts.filter(sp => sp.phaseOrderIndex === d.phase).map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        )}
      </div>
    ),
  };
}
function ownerStep(teamUsers: { id: string; fullName: string }[]): WizardStep {
  return {
    key: 'owner', label: 'עובד אחראי',
    summary: d => d.ownerName || '',
    render: (d, set) => (
      <select autoFocus value={d.ownerName || ''} onChange={e => set({ ownerName: e.target.value })} className={wizFieldClass}>
        <option value="">— בחר עובד אחראי —</option>
        {teamUsers.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
      </select>
    ),
  };
}
function durationStep(): WizardStep {
  return {
    key: 'duration', label: 'משך משוער',
    summary: d => d.estimatedMins ? `כ-${d.estimatedMins} דק'` : '',
    render: (d, set) => (
      <div className="flex flex-wrap items-center gap-[6px]">
        {DURATION_CHIPS.map(mins => (
          <span key={mins} onClick={() => set({ estimatedMins: mins })} className={wizChipClass} style={wizChipStyle(d.estimatedMins === mins)}>{mins} דק'</span>
        ))}
        <input type="number" min={1} placeholder="אחר…" value={d.estimatedMins && !DURATION_CHIPS.includes(d.estimatedMins) ? d.estimatedMins : ''}
          onChange={e => set({ estimatedMins: e.target.value ? parseInt(e.target.value) : undefined })}
          className={cn(wizFieldClass, 'w-[80px]')} />
      </div>
    ),
  };
}
function notesStep(): WizardStep {
  return {
    key: 'notes', label: 'הערות',
    summary: d => d.dependencyNote || '',
    render: (d, set) => (
      <textarea value={d.dependencyNote || ''} onChange={e => set({ dependencyNote: e.target.value })}
        placeholder="הערות, תלויות, פרטים נוספים (אופציונלי)..." className={cn(wizFieldClass, 'min-h-[56px] resize-y')} />
    ),
  };
}
function objectTypeStep(): WizardStep {
  return {
    key: 'objectType', label: 'סוג האובייקט',
    summary: d => d.type || '',
    render: (d, set) => (
      <div className="flex flex-wrap gap-[6px]">
        {MONITORING_TYPES.map(t => <span key={t} onClick={() => set({ type: t })} className={wizChipClass} style={wizChipStyle(d.type === t)}>{t}</span>)}
      </div>
    ),
  };
}
function objectNameStep(): WizardStep {
  return {
    key: 'objectName', label: 'שם האובייקט',
    summary: d => d.name || '',
    render: (d, set) => (
      <input autoFocus value={d.name || ''} onChange={e => set({ name: e.target.value })}
        placeholder="שם הטבלה / ממשק / תהליך המנוטר..." className={wizFieldClass} />
    ),
  };
}
function assigneeStep(teamUsers: { id: string; fullName: string }[]): WizardStep {
  return {
    key: 'assignee', label: 'אחראי מעקב',
    summary: d => d.assignedUserName || '',
    render: (d, set) => (
      <select autoFocus value={d.assignedUserName || ''} onChange={e => set({ assignedUserName: e.target.value })} className={wizFieldClass}>
        <option value="">— בחר עובד אחראי —</option>
        {teamUsers.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
      </select>
    ),
  };
}
function successCriteriaStep(): WizardStep {
  return {
    key: 'note', label: 'קריטריון הצלחה',
    summary: d => d.note || '',
    render: (d, set) => (
      <textarea autoFocus value={d.note || ''} onChange={e => set({ note: e.target.value })}
        placeholder="מה מעיד שהמעקב תקין? (אופציונלי)" className={cn(wizFieldClass, 'min-h-[56px] resize-y')} />
    ),
  };
}

function stepsForType(
  type: WizardTaskType,
  phaseOptions: number[], phaseLabels: Record<number, string>, subPhaseOpts: SubPhaseOpt[],
  teamAppList: string[], teamUsers: { id: string; fullName: string }[],
): WizardStep[] {
  if (type === 'Monitoring') {
    return [objectTypeStep(), objectNameStep(), phaseStep('שלב', phaseOptions, phaseLabels, subPhaseOpts), assigneeStep(teamUsers), successCriteriaStep()];
  }
  if (type === 'Validation') {
    return [
      phaseStep('שלב הבדיקה', phaseOptions, phaseLabels, subPhaseOpts),
      descriptionStep('תיאור התרחיש', 'תאר את תרחיש הבדיקה...'),
      systemStep(teamAppList), ownerStep(teamUsers), durationStep(),
    ];
  }
  return [descriptionStep(), systemStep(teamAppList), phaseStep('שלב', phaseOptions, phaseLabels, subPhaseOpts), ownerStep(teamUsers), durationStep(), notesStep()];
}

function wizardNarrative(type: WizardTaskType, d: WizardData, teamName: string): string {
  const who = d.ownerName || d.assignedUserName ? `${d.ownerName || d.assignedUserName} מ-${teamName}` : `מישהו מ-${teamName}`;
  if (type === 'Monitoring') {
    return `${who} יעקוב אחר ${d.type || 'האובייקט'} ${d.name ? `"${d.name}"` : ''}${d.note ? ` — ${d.note}` : ''}.`.trim();
  }
  const actionLabel = WIZARD_TYPES.find(t => t.type === type)?.actionType || d.actionType || 'פעולה';
  const sys = d.system ? ` במערכת ${d.system}` : '';
  const dur = d.estimatedMins ? ` משך משוער כ-${d.estimatedMins} דק'.` : '';
  const desc = d.description ? ` — ${d.description}` : '';
  return `${who} יבצע ${actionLabel}${sys}${desc}.${dur}`;
}

const TaskWizardModal: React.FC<{
  crNumber: string; teamName: string;
  initialType: WizardTaskType | null; initialPhase: number;
  phaseOptions: number[]; phaseLabels: Record<number, string>; subPhaseOpts: SubPhaseOpt[];
  teamAppList: string[]; teamUsers: { id: string; fullName: string }[];
  onCancel: () => void;
  onConfirm: (result: { kind: 'action'; action: CrPlanAction } | { kind: 'monitoring'; point: CrPlanMonitoringPoint }) => void;
}> = ({ crNumber, teamName, initialType, initialPhase, phaseOptions, phaseLabels, subPhaseOpts, teamAppList, teamUsers, onCancel, onConfirm }) => {
  const [type, setType] = useState<WizardTaskType | null>(initialType);
  const [stepIdx, setStepIdx] = useState(initialType ? 0 : -1); // -1 = type picker
  const [data, setData] = useState<WizardData>({ phase: initialPhase });

  const steps = type ? stepsForType(type, phaseOptions, phaseLabels, subPhaseOpts, teamAppList, teamUsers) : [];
  const patch = (p: WizardData) => setData(d => ({ ...d, ...p }));
  const pickType = (t: WizardTaskType) => { setType(t); setStepIdx(0); setData({ phase: initialPhase }); };

  const confirm = () => {
    if (!type) return;
    if (type === 'Monitoring') {
      onConfirm({ kind: 'monitoring', point: { type: data.type || MONITORING_TYPES[0], name: data.name || '', note: data.note, phase: data.phase ?? initialPhase, assignedUserName: data.assignedUserName } });
    } else {
      const actionType = WIZARD_TYPES.find(t => t.type === type)?.actionType || ACTION_TYPE_OPTIONS[0];
      onConfirm({ kind: 'action', action: { actionType, description: data.description || '', phase: data.phase ?? initialPhase, subPhaseId: data.subPhaseId, system: data.system, estimatedMins: data.estimatedMins, ownerName: data.ownerName, dependencyNote: data.dependencyNote } });
    }
  };

  const wizTypeMeta = type ? WIZARD_TYPES.find(t => t.type === type) : null;

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center" style={{ background: C.bgOverlay }}
      onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        className="flex max-h-[86vh] w-[92vw] max-w-[600px] flex-col rounded-xl bg-card shadow-lg">

        <div className="shrink-0 px-6 pt-5">
          <div className="mb-[10px] flex items-center gap-2">
            <span className="rounded-sm px-[10px] py-[3px] font-mono text-xs font-bold" style={{ color: GOLIVE, background: `${GOLIVE}1e` }}>{crNumber}</span>
            {wizTypeMeta && (
              <span className="rounded-full px-[11px] py-[3px] text-[11px] font-bold" style={{ background: `${C.brand}1e`, color: C.brand }}>{wizTypeMeta.icon} {wizTypeMeta.label}</span>
            )}
          </div>
          <div className="text-[17px] font-bold text-foreground">
            {stepIdx === -1 ? 'הוספת משימה — שלב 1: סוג המשימה' : `שלב ${stepIdx + 2}: ${steps[stepIdx]?.label}`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {stepIdx === -1 ? (
            <>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[.05em] text-subtle-foreground">
                בחירת סוג המשימה קובעת אילו שדות יופיעו בהמשך
              </div>
              <div className="grid grid-cols-4 gap-2">
                {WIZARD_TYPES.map(t => (
                  <div key={t.type} onClick={() => pickType(t.type)}
                    className="cursor-pointer rounded-md border-2 px-2 py-[14px] text-center"
                    style={{
                      borderColor: type === t.type ? GOLIVE : C.borderEm,
                      background: type === t.type ? `${GOLIVE}1a` : C.bgCard,
                    }}>
                    <div className="mb-[6px] text-lg">{t.icon}</div>
                    <div className="text-[11px] font-bold" style={{ color: type === t.type ? GOLIVE : C.textSecondary }}>{t.label}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {steps.map((s, i) => {
                const isDone = i < stepIdx;
                const isActive = i === stepIdx;
                const canJump = i <= stepIdx;
                return (
                  <div key={s.key} className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
                    <div onClick={() => canJump && setStepIdx(i)}
                      className={cn('flex items-center gap-[10px] px-[15px] py-[11px]', canJump ? 'cursor-pointer' : 'cursor-default')}
                      style={{
                        background: isDone ? `${C.success}12` : isActive ? `${GOLIVE}10` : 'transparent',
                      }}>
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={{
                          background: isDone ? C.success : isActive ? GOLIVE : C.bgNested,
                          color: isDone || isActive ? '#fff' : C.textMuted,
                        }}>
                        {isDone ? '✓' : i + 1}
                      </span>
                      <span className="flex-1 text-[12.5px] font-bold text-foreground">{s.label}</span>
                      {!isActive && <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-subtle-foreground">{s.summary(data) || '—'}</span>}
                    </div>
                    {isActive && <div className="border-t border-border px-[15px] pb-[15px] pt-[14px]">{s.render(data, patch)}</div>}
                  </div>
                );
              })}

              {stepIdx >= 0 && (
                <div className="mt-0.5 rounded-lg border border-dashed px-[15px] py-3" style={{ borderColor: GOLIVE, background: C.bgNested }}>
                  <div className="mb-[5px] text-[10.5px] font-bold uppercase tracking-[.05em]" style={{ color: GOLIVE }}>🔊 תצוגה מקדימה</div>
                  <div className="text-[13px] leading-[1.6] text-foreground">{type ? wizardNarrative(type, data, teamName) : ''}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-[10px] border-t border-border px-5 py-[14px]">
          <button onClick={onCancel} className="rounded-md border border-border px-[18px] py-[11px] text-[13px] font-semibold text-subtle-foreground">
            ביטול
          </button>
          {stepIdx >= 0 && !(stepIdx === 0 && initialType) && (
            <button onClick={() => setStepIdx(i => i - 1)}
              className="rounded-md border border-border px-[18px] py-[11px] text-[13px] font-semibold text-muted-foreground">
              ‹ הקודם
            </button>
          )}
          <div className="flex-1" />
          {stepIdx === -1 ? null : stepIdx < steps.length - 1 ? (
            <button onClick={() => setStepIdx(i => i + 1)}
              className="max-w-[200px] flex-1 rounded-md p-[11px] text-[13px] font-bold text-white" style={{ background: GOLIVE }}>
              הבא ›
            </button>
          ) : (
            <button onClick={confirm}
              className="max-w-[200px] flex-1 rounded-md p-[11px] text-[13px] font-bold text-white" style={{ background: GOLIVE }}>
              ✓ הוסף לתוכנית
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── TARGET CR — dedicated defect-approval gate, replaces the regular
// impact/actions/monitoring/rollback form entirely for CRs whose label/type
// contains "TARGET" (an umbrella CR wrapping a batch of QC defects for a team,
// not a real development CR). See backend/src/target-cr for the data model. ──

interface TargetDefectRow {
  id: string | null;
  defectId: string;
  title: string;
  status: string;
  severity: string;
  assignedTo: string;
  requiresSpecialImplementation: boolean;
  importantToManagement: boolean;
}
interface TargetReviewData {
  review: {
    id: string; gateChecklist1: boolean; gateChecklist2: boolean; gateChecklist3: boolean;
    approved: boolean; approvedByName: string | null; approvedAt: string | null;
  };
  teamName: string;
  defects: TargetDefectRow[];
}

// QC defect status is free text (Closed/Fixed_Test/Canceled/Open/...) — only
// canceled and closed get an explicit color, everything else (open, fixed,
// in-progress, etc.) is "still needs attention" red.
const targetDefectStatusColor = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s.includes('cancel')) return '#000000';
  if (s.includes('closed')) return C.success;
  return C.danger;
};

export const TeamLeadProposalView: React.FC<Props> = ({ token, versionId, versionName, teamIdOverride, teamNameOverride, reviewMeetingTime, isManager }) => {
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [crItems, setCrItems]           = useState<CrItem[]>([]);
  const [users, setUsers]               = useState<User[]>([]);
  const [myTeamName, setMyTeamName]     = useState('');
  const [myTeamId, setMyTeamId]         = useState('');
  // Default-locked to the submitting team — the checkbox is an explicit opt-in
  // to assign a task to a different (e.g. QA) team, not the default path.
  const [allowOtherTeam, setAllowOtherTeam] = useState(false);
  const [teams, setTeams]               = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  // Cross-team coordination info per CR — all teams + systems touching it,
  // not just this lead's own (see cr-scope endpoint on version-cr-assignments).
  const [crScope, setCrScope]           = useState<Record<string, { teamNames: string[]; systems: string[] }>>({});

  // Submission state
  const [submissionDone, setSubmissionDone] = useState(false);
  // TARGET CR approval status per CR number (from TargetCrReview, not CrPlan).
  const [targetCrStatus, setTargetCrStatus] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [submitErrorCrs, setSubmitErrorCrs] = useState<string[]>([]);
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  // locked = הגשה הושלמה ולא בוצע ביטול נעילה ע"י מנהל
  const locked = submissionDone && !managerUnlocked;

  // Proposal form — tracks which CR's form is open (crNumber, FREE_KEY, or null=closed)
  const [openFormForCr, setOpenFormForCr] = useState<string | null>(null);
  const [editId, setEditId]             = useState<string | null>(null);
  const [form, setForm]                 = useState({ ...emptyForm });
  const [crSearch, setCrSearch]         = useState('');
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // CrPlan state
  const [crPlans, setCrPlans]           = useState<Record<string, CrPlanData>>({});
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const [crPlanForms, setCrPlanForms]   = useState<Record<string, CrPlanForm>>({});
  const [savingPlan, setSavingPlan]     = useState<string | null>(null);
  const [planValidationError, setPlanValidationError] = useState<Record<string, string>>({});
  const [derivedTaskNote, setDerivedTaskNote] = useState<Record<string, string>>({});
  // Per-CR: once a plan is SUBMITTED/APPROVED the form locks read-only — clicking
  // the confirm button again shouldn't silently keep re-saving it. An explicit
  // "פתח לעריכה" unlocks one specific CR for editing.
  const [unlockedForEdit, setUnlockedForEdit] = useState<Set<string>>(new Set());
  // Collapsible dependency picker — which action's picker is open, and which phase
  // groups within it are expanded. Only one can be open at a time.
  const [depPicker, setDepPicker] = useState<{ actionIdx: number; openPhases: Set<number> } | null>(null);

  // TARGET CR defect data (from Oracle via /target-cr) — keyed by crNumber,
  // separate from crPlans/crPlanForms since it's a different data source
  // (QC defect rows, not CrPlan fields), even though the linked action each
  // defect drives lives in the very same crPlanForms[crNumber].actions.
  const [targetReviewByCr, setTargetReviewByCr] = useState<Record<string, TargetReviewData>>({});
  const [targetReviewLoading, setTargetReviewLoading] = useState<Record<string, boolean>>({});
  const [targetReviewError, setTargetReviewError] = useState<Record<string, string>>({});
  const [targetApproving, setTargetApproving] = useState<string | null>(null);
  // "תוקנו / פתוחות / פתוחות ומאושרות לעלייה" — real-CR defect indicators
  // (not TARGET — a different QC mechanism, see getCrDefectIndicators) shown
  // at the top of each CR's plan form. Keyed by crNumber, fetched once per CR
  // the first time its plan form renders. Which bucket (if any) is currently
  // expanded inline is separate per-CR state so opening one CR's list doesn't
  // affect another's.
  const [crDefectIndicatorsByCr, setCrDefectIndicatorsByCr] = useState<Record<string, { fixed: any[]; open: any[]; openApproved: any[] }>>({});
  const [crDefectIndicatorsLoading, setCrDefectIndicatorsLoading] = useState<Record<string, boolean>>({});
  const [expandedDefectBucket, setExpandedDefectBucket] = useState<Record<string, 'fixed' | 'open' | 'openApproved' | null>>({});
  // Visual grouping only (Timeline Planning) — collapses/expands an
  // actionType container within a phase bucket; key = `${phase}-${actionType}`.
  // Defaults to all-expanded so nothing regresses for existing plans.
  const [collapsedContainers, setCollapsedContainers] = useState<Set<string>>(new Set());
  // Task Wizard — guided step-by-step modal for adding a single action or
  // monitoring point. `type: null` means step 1 (type picker) hasn't been
  // resolved yet; a non-null type skips straight to that type's first field
  // step (used when opened from the dedicated "+ monitoring point" button).
  const [taskWizard, setTaskWizard] = useState<{
    crNumber: string; phase: number; type: WizardTaskType | null; step: number;
    data: Partial<CrPlanAction & CrPlanMonitoringPoint>;
  } | null>(null);
  const [selectedCr, setSelectedCr]   = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'plan' | 'tasks'>('plan');
  // CRs with local edits made since the last successful save — edits only live in
  // client state until "✓ אשר תוכנית CR" is clicked, so switching away silently
  // leaves them unsaved on the server.
  const [dirtyCrs, setDirtyCrs] = useState<Set<string>>(new Set());
  const trySelectCr = (next: string | null, tab: 'plan' | 'tasks' = 'plan') => {
    if (selectedCr && selectedCr !== next && dirtyCrs.has(selectedCr)) {
      const leavingCr = selectedCr;
      setDialog({
        title: 'תוכנית לא אושרה',
        message: `ביצעת שינויים ב-CR ${leavingCr} שטרם אושרו (לחיצה על "✓ אשר תוכנית CR"). מעבר ל-CR אחר לא ישמור אותם.\n\nלעבור בכל זאת?`,
        variant: 'warning',
        confirmLabel: 'עבור בכל זאת',
        cancelLabel: 'הישאר בעמוד',
        onConfirm: () => { setSelectedCr(next); setSelectedTab(tab); },
        onCancel: () => {},
      });
      return;
    }
    setSelectedCr(next);
    setSelectedTab(tab);
  };
  // Cross-team visibility — status only (never another team's plan content) for
  // every CR our own team is assigned to, so a lead can see at a glance whether
  // the other teams sharing a CR have started/submitted yet.
  const [teamVisibility, setTeamVisibility] = useState<Record<string, { crLabel: string | null; teams: TeamVisibilityRow[] }>>({});
  const [teamPreview, setTeamPreview] = useState<{ teamName: string; loading: boolean; error: string | null; data: TeamPlanPreview | null } | null>(null);

  const openTeamPreview = useCallback(async (crNumber: string, teamId: string, teamName: string) => {
    setTeamPreview({ teamName, loading: true, error: null, data: null });
    try {
      const res = await axios.get(`${API}/cr-plans/version/${versionId}/cr/${crNumber}/team/${teamId}/preview`, { headers: { Authorization: `Bearer ${token}` } });
      setTeamPreview({ teamName, loading: false, error: null, data: res.data });
    } catch (e: any) {
      setTeamPreview({ teamName, loading: false, error: e?.response?.data?.message ?? 'שגיאה בטעינת תצוגה מקדימה', data: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  // Extract-tasks modal
  interface ExtractItem { text: string; checked: boolean; phase: number; estimatedMins: string; assignedUserName: string; duplicateId?: string; }
  const [extractModal, setExtractModal] = useState<{
    crNumber: string;
    sourceLabel: string;
    defaultPhase: number;
    items: ExtractItem[];
  } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const parseTextToLines = (text: string): string[] =>
    text
      .split(/\n|•|·|–|—|\d+\.\s/)
      .map(l => l.replace(/^[-*\s]+/, '').trim())
      .filter(l => l.length > 2);

  const openExtract = (crNumber: string, text: string, sourceLabel: string, defaultPhase: number) => {
    const lines = parseTextToLines(text);
    if (!lines.length) return;
    setExtractModal({
      crNumber,
      sourceLabel,
      defaultPhase,
      items: lines.map(t => {
        const dup = proposals.find(p => p.crNumber === crNumber && p.title.trim().toLowerCase() === t.trim().toLowerCase());
        return { text: t, checked: true, phase: defaultPhase, estimatedMins: '', assignedUserName: dup?.assignedUserName || '', duplicateId: dup?.id };
      }),
    });
  };

  const doCreateExtracted = async (replaceConflicts: boolean) => {
    if (!extractModal) return;
    const toCreate = extractModal.items.filter(i => i.checked && i.text.trim());
    setExtracting(true);
    try {
      for (const item of toCreate) {
        if (item.duplicateId) {
          if (!replaceConflicts) continue;
          await axios.patch(`${API}/task-proposals/${item.duplicateId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
            assignedUserName: item.assignedUserName || undefined,
          }, { headers });
        } else {
          await axios.post(`${API}/task-proposals/version/${versionId}`, {
            title: item.text.trim(), phase: item.phase,
            estimatedMins: item.estimatedMins ? parseInt(item.estimatedMins) : undefined,
            assignedUserName: item.assignedUserName || undefined,
            crNumber: extractModal.crNumber,
            crLabel: getCrLabel(extractModal.crNumber) || undefined,
            ...(teamIdOverride ? { teamIdOverride } : {}),
          }, { headers });
        }
      }
      await fetchProposals();
      setExtractModal(null);
    } finally { setExtracting(false); }
  };

  const createExtracted = () => {
    if (!extractModal) return;
    const conflicts = extractModal.items.filter(i => i.checked && i.duplicateId);
    if (conflicts.length > 0) {
      setDialog({
        title: 'משימות כפולות',
        message: `${conflicts.length} מהמשימות שבחרת כבר קיימות.\nהאם להחליף אותן בגרסה החדשה?`,
        variant: 'warning',
        confirmLabel: 'החלף',
        cancelLabel: 'דלג על הקיימות',
        onConfirm: () => doCreateExtracted(true),
        onCancel:  () => doCreateExtracted(false),
      });
    } else {
      doCreateExtracted(false);
    }
  };

  // Sub-phases from version plan
  const [subPhaseOpts, setSubPhaseOpts] = useState<{ id: string; name: string; phaseName: string; phaseOrderIndex: number }[]>([]);

  useEffect(() => {
    if (!versionId) return;
    axios.get(`${API}/versions/${versionId}/sub-phases`, { headers })
      .then(r => {
        const opts: typeof subPhaseOpts = [];
        for (const phase of r.data) {
          for (const sp of phase.subPhases) {
            opts.push({ id: sp.id, name: sp.name, phaseName: phase.name, phaseOrderIndex: phase.orderIndex });
          }
        }
        setSubPhaseOpts(opts);
      })
      .catch(() => {});
  }, [versionId]); // eslint-disable-line

  // Real tasks already scheduled in this version's framework plan — used to let a team
  // pick an actual dependency instead of typing free text (TEAM_LEAD sees all teams' tasks).
  const [frameworkTasks, setFrameworkTasks] = useState<{ id: string; title: string; subPhaseId: string | null }[]>([]);

  useEffect(() => {
    if (!versionId) return;
    axios.get(`${API}/tasks`, { headers, params: { versionId } })
      .then(r => setFrameworkTasks((r.data as any[]).map(t => ({ id: t.id, title: t.title, subPhaseId: t.subPhaseId }))))
      .catch(() => {});
  }, [versionId]); // eslint-disable-line

  // Framework tasks grouped שלב ← תת-שלב ← משימה, for the collapsible dependency picker.
  const frameworkTasksByPhase = useMemo(() => {
    const subPhaseById = new Map(subPhaseOpts.map(sp => [sp.id, sp]));
    const byPhase = new Map<number, { phaseLabel: string; bySubPhase: Map<string, { subPhaseName: string; tasks: { id: string; title: string }[] }> }>();
    for (const t of frameworkTasks) {
      const sp = t.subPhaseId ? subPhaseById.get(t.subPhaseId) : undefined;
      const phaseOrderIndex = sp?.phaseOrderIndex ?? 0;
      const phaseLabel = sp ? `שלב ${phaseOrderIndex} — ${sp.phaseName}` : 'ללא שלב';
      if (!byPhase.has(phaseOrderIndex)) byPhase.set(phaseOrderIndex, { phaseLabel, bySubPhase: new Map() });
      const phaseEntry = byPhase.get(phaseOrderIndex)!;
      const subKey = sp?.id ?? '__none__';
      const subName = sp?.name ?? 'ללא תת-שלב';
      if (!phaseEntry.bySubPhase.has(subKey)) phaseEntry.bySubPhase.set(subKey, { subPhaseName: subName, tasks: [] });
      phaseEntry.bySubPhase.get(subKey)!.tasks.push({ id: t.id, title: t.title });
    }
    return Array.from(byPhase.entries()).sort((a, b) => a[0] - b[0]);
  }, [frameworkTasks, subPhaseOpts]);

  // Phase labels derived from actual version phase names
  const phaseLabels = useMemo(() => {
    const map: Record<number, string> = {};
    for (const sp of subPhaseOpts) {
      if (!map[sp.phaseOrderIndex] && sp.phaseName) {
        map[sp.phaseOrderIndex] = `שלב ${sp.phaseOrderIndex} — ${sp.phaseName}`;
      }
    }
    return map;
  }, [subPhaseOpts]);
  const phaseOptions = useMemo(
    () => Object.keys(phaseLabels).length > 0 ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b) : [1, 2, 3, 4],
    [phaseLabels],
  );

  // Sync state
  const [syncLoading, setSyncLoading]   = useState(false);
  const [syncError, setSyncError]       = useState<string | null>(null);

  // "Not needed" toggle state
  const [togglingNotNeeded, setTogglingNotNeeded] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProposals = useCallback(async () => {
    try {
      const url = teamIdOverride
        ? `${API}/task-proposals/version/${versionId}?teamId=${teamIdOverride}`
        : `${API}/task-proposals/version/${versionId}`;
      const res = await axios.get(url, { headers });
      setProposals(res.data);
    } catch { /* silent */ }
  }, [versionId, teamIdOverride]); // eslint-disable-line

  const fetchCrPlans = useCallback(async () => {
    try {
      const url = teamIdOverride
        ? `${API}/cr-plans/version/${versionId}?teamId=${teamIdOverride}`
        : `${API}/cr-plans/version/${versionId}`;
      const res = await axios.get(url, { headers });
      const map: Record<string, CrPlanData> = {};
      const forms: Record<string, CrPlanForm> = {};
      for (const p of res.data as CrPlanData[]) {
        map[p.crNumber] = p;
        forms[p.crNumber] = planToForm(p);
      }
      setCrPlans(map);
      // Freshly-fetched server data must win over local state — a separate effect
      // seeds an empty draft form the moment a CR shows up in `proposals`, which can
      // race ahead of this fetch and otherwise clobber an already-submitted plan's
      // real gateAnswered/actions back to a blank gate screen (list still says "done"
      // since that reads from `crPlans`, but the detail panel would show the gate again).
      setCrPlanForms(prev => ({ ...prev, ...forms }));
    } catch { /* silent */ }
  }, [versionId]); // eslint-disable-line

  useEffect(() => {
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active)
        .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data)).catch(() => {});
    axios.get(`${API}/version-cr-assignments/version/${versionId}/cr-scope`, { headers })
      .then(r => {
        const map: Record<string, { teamNames: string[]; systems: string[] }> = {};
        (r.data ?? []).forEach((row: any) => { map[row.crNumber] = { teamNames: row.teamNames, systems: row.systems }; });
        setCrScope(map);
      })
      .catch(() => setCrScope({}));
    // Cross-team status — derived server-side from the caller's own team
    // membership, so it only makes sense for a real team lead, not a manager
    // previewing another team's screen via teamIdOverride.
    if (!teamIdOverride) {
      axios.get(`${API}/cr-plans/version/${versionId}/team-visibility`, { headers })
        .then(r => {
          const map: Record<string, { crLabel: string | null; teams: TeamVisibilityRow[] }> = {};
          (r.data ?? []).forEach((row: any) => { map[row.crNumber] = { crLabel: row.crLabel, teams: row.teams }; });
          setTeamVisibility(map);
        })
        .catch(() => setTeamVisibility({}));
    }
    Promise.all([fetchProposals(), fetchCrPlans().then(() => syncCrItems(true))])
      .finally(() => setLoading(false)); // spinner stays until proposals + CR sync complete
  }, [versionId]); // eslint-disable-line

  // Initialize myTeamId — prefer override (manager viewing another team) over JWT detection
  useEffect(() => {
    if (teamIdOverride && teamNameOverride) {
      setMyTeamId(teamIdOverride);
      setMyTeamName(teamNameOverride);
      return;
    }
    if (myTeamId || !teams.length || !token) return;
    try {
      const { sub: userId } = JSON.parse(atob(token.split('.')[1]));
      const myTeam = teams.find((t: any) =>
        (t.members || []).some((m: any) => m.user?.id === userId)
      );
      if (myTeam) { setMyTeamId(myTeam.id); setMyTeamName(myTeam.name); }
    } catch { /* silent */ }
  }, [teams, token, teamIdOverride, teamNameOverride]); // eslint-disable-line

  // Fetch submission status for this team
  useEffect(() => {
    if (!myTeamId || !versionId) return;
    axios.get(`${API}/versions/${versionId}/submissions`, { headers })
      .then(r => {
        const mine = (r.data as any[]).find(s => s.teamId === myTeamId);
        if (mine?.status === 'SUBMITTED') setSubmissionDone(true);
      })
      .catch(() => {});
  }, [myTeamId, versionId]); // eslint-disable-line

  // TARGET CR approval lives on TargetCrReview, entirely separate from
  // CrPlan.submissionStatus — without this, a fully-approved TARGET CR would
  // show "ממתין" forever since the regular submitted/approved check never
  // reflects it.
  useEffect(() => {
    if (!myTeamId || !versionId) return;
    axios.get(`${API}/target-cr/version/${versionId}/status`, { headers, params: { teamId: myTeamId } })
      .then(r => setTargetCrStatus(r.data ?? {}))
      .catch(() => setTargetCrStatus({}));
  }, [myTeamId, versionId]); // eslint-disable-line

  // Initialize crPlanForm for new CRs not yet saved
  useEffect(() => {
    const grouped = proposals.reduce((acc, p) => {
      if (p.crNumber && !acc[p.crNumber]) acc[p.crNumber] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setCrPlanForms(prev => {
      const next = { ...prev };
      for (const cr of Object.keys(grouped)) {
        if (!next[cr]) next[cr] = emptyCrPlanForm();
      }
      return next;
    });
  }, [proposals]);

  // Auto-select first actionable CR on load (uses proposals+crPlans, not crGroups which is declared later)
  useEffect(() => {
    if (selectedCr) return;
    const allNums = Array.from(new Set([
      ...proposals.filter(p => p.crNumber).map(p => p.crNumber!),
      ...Object.keys(crPlans),
    ])).sort();
    const first = allNums.find(cr => !crPlans[cr]?.notNeededForPlan);
    if (first) setSelectedCr(first);
  }, [proposals, crPlans]); // eslint-disable-line

  // Group proposals: by crNumber or FREE_KEY
  const grouped = proposals.reduce((acc, p) => {
    const key = p.crNumber || FREE_KEY;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, Proposal[]>);

  // crScope (fetched from version-cr-assignments' cross-team endpoint) is the
  // authoritative "which CRs actually touch my team" source — grouped/crPlans
  // only cover CRs that already have a proposal or CrPlan row, so a CR the
  // lead hasn't opened yet (syncCrItems hasn't run, or hasn't caught up) was
  // previously invisible to crGroups entirely: the denominator undercounted,
  // letting "X/Y done" read 100% while assigned CRs sat untouched.
  const myTeamLabel = teamNameOverride || myTeamName;
  const allCrKeys = new Set([
    ...Object.keys(grouped).filter(k => k !== FREE_KEY),
    ...Object.keys(crPlans),
    ...Object.entries(crScope).filter(([, s]) => s.teamNames.includes(myTeamLabel)).map(([cr]) => cr),
  ]);
  const crGroups: [string, Proposal[]][] = Array.from(allCrKeys)
    .sort()
    .map(cr => [cr, grouped[cr] || []]);
  const freeGroup = grouped[FREE_KEY] || [];

  // All CR numbers that appear in proposals (for dependency picker)
  const allCrNumbers = crGroups.map(([cr]) => cr);

  const getCrLabel = (crNum: string) => {
    const fromApi = crItems.find(c => c.id === crNum);
    if (fromApi) return fromApi.label;
    const fromProposal = proposals.find(x => x.crNumber === crNum)?.crLabel;
    if (fromProposal) return fromProposal;
    return crPlans[crNum]?.crLabel || '';
  };

  // Full CR description as it appears in the source CR_LIST (Oracle/Excel import) —
  // distinct from the (often shorter) title/label.
  const getCrDescription = (crNum: string) => {
    const fromApi = crItems.find(c => c.id === crNum)?.crDescription;
    if (fromApi) return fromApi;
    return crPlans[crNum]?.crDescription || '';
  };

  const openAdd = (crNumber?: string, crLabel?: string, isFree?: boolean) => {
    setEditId(null);
    setForm({ ...emptyForm, crNumber: crNumber || '', crLabel: crLabel || '', isFree: isFree ?? false, responsibleTeamId: myTeamId });
    setAllowOtherTeam(false);
    setCrSearch(crNumber || '');
    setError(null);
    setOpenFormForCr(isFree ? FREE_KEY : (crNumber || FREE_KEY));
  };

  const openEdit = (p: Proposal) => {
    setEditId(p.id);
    const responsibleTeamId = (p as any).responsibleTeamId ?? '';
    setForm({
      title: p.title, app: p.app ?? '', actionType: p.actionType ?? '',
      estimatedMins: p.estimatedMins?.toString() ?? '',
      crNumber: p.crNumber ?? '', crLabel: p.crLabel ?? '', isFree: !p.crNumber,
      notes: p.notes ?? '', assignedUserName: p.assignedUserName ?? '', phase: p.phase,
      subPhaseId: '',
      responsibleTeamId,
    });
    // Pre-check the box if this task was already assigned to a team other than
    // ours, so an existing cross-team assignment stays visible instead of
    // being silently forced back to our own team.
    setAllowOtherTeam(!!responsibleTeamId && responsibleTeamId !== myTeamId);
    setCrSearch(p.crNumber || '');
    setError(null);
    setOpenFormForCr(p.crNumber || FREE_KEY);
  };

  const cancelForm = () => { setOpenFormForCr(null); setEditId(null); setCrSearch(''); };

  const save = async () => {
    // Monitoring-point-derived tasks never have app/actionType/estimatedMins —
    // those concepts don't apply to a monitoring point (see toggleStatus above).
    const isMonitoringDerived = form.title?.startsWith('בקרה — ');
    if (!form.title.trim())        { setError('שם המשימה הוא שדה חובה'); return; }
    if (!isMonitoringDerived) {
      if (!form.app)               { setError('יש לבחור מערכת'); return; }
      if (!form.actionType)        { setError('יש לבחור סוג פעולה'); return; }
      if (!form.estimatedMins)     { setError('יש להזין משך משוער'); return; }
    }
    if (!form.assignedUserName)    { setError('יש לבחור עובד אחראי'); return; }
    if (!form.isFree && !form.crNumber) { setError('יש לבחור CR מקושר, או לסמן "ללא CR"'); return; }
    setSaving(true); setError(null);
    try {
      const crItem = !form.isFree ? crItems.find(c => c.id === form.crNumber) : null;
      const payload = {
        title: form.title.trim(),
        phase: form.phase,
        app: form.app || undefined,
        actionType: form.actionType || undefined,
        subPhaseId: form.subPhaseId || undefined,
        estimatedMins: form.estimatedMins ? parseInt(form.estimatedMins) : undefined,
        crNumber: form.isFree ? undefined : (form.crNumber || undefined),
        crLabel: crItem?.label || form.crLabel || undefined,
        notes: form.notes || undefined,
        assignedUserName: form.assignedUserName || undefined,
        responsibleTeamId: form.responsibleTeamId || myTeamId || undefined,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      };
      if (editId) {
        await axios.patch(`${API}/task-proposals/${editId}`, payload, { headers });
      } else {
        await axios.post(`${API}/task-proposals/version/${versionId}`, payload, { headers });
      }
      cancelForm();
      await fetchProposals();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בשמירה');
    } finally { setSaving(false); }
  };

  const remove = (p: Proposal) => {
    setDialog({
      title: 'מחיקת צעד',
      message: `האם למחוק את הצעד "${p.title}"?\nפעולה זו בלתי הפיכה.`,
      variant: 'danger',
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        await axios.delete(`${API}/task-proposals/${p.id}`, { headers });
        await fetchProposals();
      },
      onCancel: () => {},
    });
  };

  const toggleStatus = async (p: Proposal) => {
    if (p.status === 'DRAFT') {
      // Monitoring-point-derived tasks (created via Section 2's "בקרה" wizard flow)
      // never have app/actionType/estimatedMins — those concepts don't apply to a
      // monitoring point, and the backend deliberately leaves them null (see
      // syncDerivedProposals in cr-plans.service.ts). Requiring them here would
      // ask the user to re-fill fields the wizard never asked for in the first
      // place. Detected by the fixed title prefix the backend always generates.
      const isMonitoringDerived = p.title?.startsWith('בקרה — ');
      const missing: string[] = [];
      if (!p.title?.trim())        missing.push('תיאור משימה');
      if (!isMonitoringDerived) {
        if (!p.app)                missing.push('מערכת');
        if (!p.actionType)         missing.push('סוג פעולה');
        if (!p.estimatedMins)      missing.push('משך משוער');
      }
      if (!p.assignedUserName)     missing.push('עובד אחראי');
      if (missing.length > 0) {
        setDialog({
          title: 'שדות חובה חסרים',
          message: `לא ניתן לסמן כ"מוכן" — יש להשלים:\n• ${missing.join('\n• ')}\n\nלחץ "ערוך" כדי להשלים את הנתונים.`,
          variant: 'warning',
          confirmLabel: 'ערוך משימה',
          cancelLabel: 'ביטול',
          onConfirm: () => openEdit(p),
          onCancel: () => {},
        });
        return;
      }
    }
    const next = p.status === 'DRAFT' ? 'READY' : 'DRAFT';
    await axios.patch(`${API}/task-proposals/${p.id}`, { status: next }, { headers });
    await fetchProposals();
  };

  const syncCrItems = async (silent = false) => {
    if (!silent) { setSyncLoading(true); setSyncError(null); }
    try {
      const syncUrl = teamIdOverride
        ? `${API}/import/crs-for-team?versionId=${versionId}&teamId=${teamIdOverride}`
        : `${API}/import/crs-for-team?versionId=${versionId}`;
      const res = await axios.get(syncUrl, { headers });
      const crs: { crNumber: string; crLabel: string; application: string; crManager: string; crDescription: string }[] = res.data;
      if (crs.length === 0) {
        if (!silent) setSyncError('לא נמצאו CR-ים עבור הצוות שלך בגרסה זו בקובץ');
        return;
      }
      // Merge into crItems — update existing entries and add new ones
      setCrItems(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const updated = prev.map(c => {
          const fresh = crs.find(cr => cr.crNumber === c.id);
          return fresh ? { ...c, crManager: fresh.crManager, crDescription: fresh.crDescription } : c;
        });
        const toAdd = crs.filter(c => !existingIds.has(c.crNumber))
          .map(c => ({ id: c.crNumber, label: c.crLabel, crManager: c.crManager, crDescription: c.crDescription }));
        return [...updated, ...toAdd];
      });
      // Create a CrPlan entry for any CR not seen before. syncOnly tells the backend
      // to never touch (or resurrect) a plan the team already explicitly deleted, and
      // to leave gate/actions/dependencies alone on plans that already exist.
      await Promise.all(crs.map(c =>
        axios.post(`${API}/cr-plans/version/${versionId}`, {
          crNumber: c.crNumber,
          crLabel: c.crLabel,
          crManager: c.crManager || undefined,
          crDescription: c.crDescription || undefined,
          syncOnly: true,
          ...(teamIdOverride ? { teamIdOverride } : {}),
        }, { headers }).catch(() => { /* skip if already exists */ })
      ));
      await fetchCrPlans();
    } catch (e: any) {
      if (!silent) setSyncError(e?.response?.data?.message ?? 'שגיאה בסנכרון, נסה שוב');
    }
    finally { if (!silent) setSyncLoading(false); }
  };

  const deleteCrGroup = (crNumber: string) => {
    setDialog({
      title: `מחיקת CR ${crNumber}`,
      message: 'כל הצעדים תחת CR זה יימחקו.\nהפעולה בלתי הפיכה — האם להמשיך?',
      variant: 'danger',
      confirmLabel: 'מחק CR',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
        await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers });
        const plan = crPlans[crNumber];
        if (plan) await axios.delete(`${API}/cr-plans/${plan.id}`, { headers });
        setCrPlanForms(prev => { const next = { ...prev }; delete next[crNumber]; return next; });
        if (selectedCr === crNumber) setSelectedCr(null);
        await Promise.all([fetchProposals(), fetchCrPlans()]);
      },
      onCancel: () => {},
    });
  };

  const togglePlanExpanded = (crNumber: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev);
      if (next.has(crNumber)) next.delete(crNumber); else next.add(crNumber);
      return next;
    });
    if (!crPlanForms[crNumber]) {
      setCrPlanForms(prev => ({ ...prev, [crNumber]: emptyCrPlanForm() }));
    }
  };

  const saveCrPlan = async (crNumber: string, overrides?: Partial<CrPlanForm>, notNeededForPlan?: boolean) => {
    const f = { ...(crPlanForms[crNumber] || emptyCrPlanForm()), ...overrides };
    setSavingPlan(crNumber);
    try {
      const label = getCrLabel(crNumber) || crPlans[crNumber]?.crLabel || '';
      const res = await axios.post(`${API}/cr-plans/version/${versionId}`, {
        crNumber,
        crLabel: label || undefined,
        crType: f.crType || undefined,
        riskLevel: f.riskLevel || undefined,
        systems: f.systems.length ? f.systems : undefined,
        workPlan: f.workPlan || undefined,
        scripts: f.scripts || undefined,
        runTimes: f.runTimes || undefined,
        rollbackPlan: f.rollbackPlan || undefined,
        gradualRollout: f.gradualRollout,
        gradualDetails: f.gradualDetails || undefined,
        activationDate: f.gradualRollout && f.activationDate ? f.activationDate : null,
        nightTestingNotes: f.nightTestingNotes || undefined,
        morningMonitoring: f.morningMonitoring || undefined,
        dependsOnCrs: f.dependsOnCrs,
        dependencyNotes: f.dependencyNotes,
        notNeededForPlan: notNeededForPlan !== undefined ? notNeededForPlan : crPlans[crNumber]?.notNeededForPlan,
        gateAnswered: f.gateAnswered,
        changeTypes: f.changeTypes,
        prerequisites: f.prerequisites,
        prerequisitesNote: f.prerequisitesNote || undefined,
        nightTestNeeded: f.nightTestNeeded,
        nextDayTestNeeded: f.nextDayTestNeeded,
        nextDayTestNotes: f.nextDayTestNotes || undefined,
        rollbackType: f.rollbackType || undefined,
        actions: f.actions,
        monitoringPoints: f.monitoringPoints,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: res.data }));
      // Rebuild form state from the server response (not the locally-sent `f`) so
      // ids assigned to newly-created actions/monitoring points flow back into local
      // state — otherwise the next save can't match them by id and would duplicate them.
      setCrPlanForms(prev => ({ ...prev, [crNumber]: planToForm(res.data) }));
      setDirtyCrs(prev => { const next = new Set(prev); next.delete(crNumber); return next; });
      return res.data as CrPlanData;
    } catch { /* silent */ return null; }
    finally { setSavingPlan(null); }
  };

  // Section-1 gate answer: "No" = no special impact (saves + submits immediately,
  // matching the mockup's single-click "אשר וחזור לרשימה"). "Yes" reveals sections 2-7.
  // Submits a saved plan (DRAFT → SUBMITTED) and merges the response into crPlans[crNumber]
  // only — NOT a full fetchCrPlans() refetch, which would race with other CRs being
  // answered/confirmed concurrently and can clobber a just-saved sibling CR with a stale
  // snapshot (e.g. rapid-fire "No" clicks across several CRs).
  const submitCrPlan = async (crNumber: string, planId: string) => {
    try {
      const res = await axios.patch(`${API}/cr-plans/${planId}/submit`, {}, { headers });
      const { derivedTasks, ...plan } = res.data;
      setCrPlans(prev => ({ ...prev, [crNumber]: { ...prev[crNumber], ...plan } }));
      const created = derivedTasks?.created ?? 0;
      const updated = derivedTasks?.updated ?? 0;
      if (created > 0 || updated > 0) {
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} משימות נוצרו`);
        if (updated > 0) parts.push(`${updated} עודכנו`);
        setDerivedTaskNote(prev => ({ ...prev, [crNumber]: `⚡ ${parts.join(' · ')} אוטומטית בלשונית "משימות נגזרות" — יש להשלים משך ביצוע ולסמן "מוכן"` }));
        await fetchProposals();
      }
    } catch { /* silent */ }
  };

  const answerGate = async (crNumber: string, hasImpact: boolean) => {
    const saved = await saveCrPlan(crNumber, { gateAnswered: true }, !hasImpact);
    if (!hasImpact && saved?.id) {
      await submitCrPlan(crNumber, saved.id);
      // A CR marked "no special impact" can't have leftover tasks — e.g. someone
      // added one manually from the "משימות נגזרות" tab before answering the gate.
      const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
      await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers }).catch(() => {});
      await fetchProposals();
    }
  };

  // Section-7 "אשר תוכנית CR" — save the full form, then submit the plan (DRAFT → SUBMITTED).
  // saveCrPlan clears `savingPlan` in its own finally as soon as the save leg finishes,
  // which used to leave the confirm button re-enabled for the whole submit leg — a
  // double-click (or an impatient re-click on a slow network) could fire this whole
  // function twice concurrently. Both overlapping submits then race
  // syncDerivedProposals: each reads the same not-yet-linked CrPlanAction and creates
  // its own TaskProposal, leaving a duplicate derived task behind. Re-asserting
  // savingPlan immediately after saveCrPlan resolves (synchronously, before the next
  // await) closes that window — see backend/src/cr-plans/cr-plans.service.ts
  // syncDerivedProposals/upsertDerivedProposal for the create-vs-update decision.
  const confirmCrPlan = async (crNumber: string) => {
    // Section 1 ("מה משתנה") must have at least one selection — otherwise the
    // plan describes no actual change to the CR.
    if (!(crPlanForms[crNumber]?.changeTypes.length)) {
      setPlanValidationError(prev => ({ ...prev, [crNumber]: 'יש לבחור לפחות סוג שינוי אחד בסעיף 1 — "מה משתנה" — לפני אישור התוכנית.' }));
      return;
    }
    // Section 2's phase timeline (הכנות/HOTNET/HOT/בוקר שלאחר) must have at least
    // one action or monitoring point somewhere — an empty timeline means the plan
    // doesn't actually say when or how the CR gets implemented.
    const planForm = crPlanForms[crNumber];
    if (!((planForm?.actions.length ?? 0) + (planForm?.monitoringPoints.length ?? 0) > 0)) {
      setPlanValidationError(prev => ({ ...prev, [crNumber]: 'יש להוסיף לפחות פעולה אחת או נקודת בקרה אחת באחד משלבי ציר הזמן בסעיף 2 — "פעולות מיוחדות" — לפני אישור התוכנית.' }));
      return;
    }
    // All derived tasks (created from this CR's actions) must be marked "מוכן"
    // before the plan can be confirmed — a plan isn't actually ready to execute
    // while its own derived tasks are still drafts. A task already converted into
    // a real scheduled Task (usedInTaskId set) counts as done even if its own
    // status field was never flipped to READY — conversion doesn't touch it.
    const notReadyTasks = (grouped[crNumber] || []).filter(p => p.status !== 'READY' && !p.usedInTaskId);
    if (notReadyTasks.length > 0) {
      setPlanValidationError(prev => ({ ...prev, [crNumber]: `יש ${notReadyTasks.length} משימות נגזרות שאינן בסטטוס "מוכן" — סומנת לטאב "משימות נגזרות" כדי לאשר אותן.` }));
      // Bounce the user straight to the tasks tab to fix it, instead of just
      // leaving them on the plan tab with a text error and no clear next step.
      setSelectedTab('tasks');
      return;
    }
    setPlanValidationError(prev => { const next = { ...prev }; delete next[crNumber]; return next; });
    setSavingPlan(crNumber);
    try {
      const saved = await saveCrPlan(crNumber);
      setSavingPlan(crNumber);
      if (saved?.id) await submitCrPlan(crNumber, saved.id);
    } finally {
      setSavingPlan(null);
      // Re-lock after a re-confirm — editing an already-submitted plan again requires
      // explicitly clicking "פתח לעריכה" again, it doesn't stay open indefinitely.
      setUnlockedForEdit(prev => { const next = new Set(prev); next.delete(crNumber); return next; });
    }
  };

  const toggleNotNeeded = async (crNumber: string) => {
    const current = crPlans[crNumber]?.notNeededForPlan ?? false;
    setTogglingNotNeeded(prev => new Set(prev).add(crNumber));
    try {
      const label = getCrLabel(crNumber) || crPlans[crNumber]?.crLabel || '';
      const res = await axios.post(`${API}/cr-plans/version/${versionId}`, {
        crNumber,
        crLabel: label || undefined,
        notNeededForPlan: !current,
        // Reverting "no special impact" reopens the gate so the team can re-answer.
        gateAnswered: current ? false : true,
        ...(teamIdOverride ? { teamIdOverride } : {}),
      }, { headers });
      setCrPlans(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || res.data), ...res.data } }));
      setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || emptyCrPlanForm()), gateAnswered: !current ? true : false } }));
      // A CR marked "no special impact" can't have leftover tasks tied to it —
      // clean up anything that was manually added before this flip.
      if (!current) {
        const teamQuery = teamIdOverride ? `?teamIdOverride=${teamIdOverride}` : '';
        await axios.delete(`${API}/task-proposals/version/${versionId}/cr/${crNumber}${teamQuery}`, { headers }).catch(() => {});
        await fetchProposals();
      }
    } catch { /* silent */ }
    finally { setTogglingNotNeeded(prev => { const next = new Set(prev); next.delete(crNumber); return next; }); }
  };

  // A CR is "done" once its plan is either flagged not-needed (gate answered "No")
  // or has been confirmed/submitted (Section 7, or CR-manager already approved it).
  const isCrDone = (cr: string) => {
    const p = crPlans[cr];
    // TARGET CR approval lives on TargetCrReview, not CrPlan — check it before the
    // `!p` guard below, or a TARGET CR with no CrPlan row (handled entirely through
    // the defect-review flow) reads as "not done" forever even once approved,
    // despite the CR list card (renderListItem) correctly showing it as finished.
    const label = getCrLabel(cr);
    const isTargetCr = /target/i.test(label || '') || /target/i.test(p?.crType || '');
    if (isTargetCr) return !!targetCrStatus[cr];
    if (!p) return false;
    if (p.notNeededForPlan) return true;
    const isSubmitted = p.submissionStatus === 'SUBMITTED' || p.submissionStatus === 'APPROVED';
    if (!isSubmitted) return false;
    return (grouped[cr] || []).every(task => task.status === 'READY' || task.usedInTaskId);
  };

  const submitDone = async () => {
    if (!myTeamId) return;

    const pendingCrs = crGroups.filter(([cr]) => !isCrDone(cr)).map(([cr]) => cr);
    if (pendingCrs.length > 0) {
      setSubmitError(`לא ניתן להגיש — יש CR-ים שטרם טופלו: ${pendingCrs.length}. לחץ על CR ברשימה למטה כדי להשלים אותו.`);
      setSubmitErrorCrs(pendingCrs);
      // Lead the team lead straight to the first unfinished CR instead of making
      // them hunt for it in the sidebar list.
      setSelectedCr(pendingCrs[0]);
      setSelectedTab('plan');
      return;
    }

    setSubmitting(true); setSubmitError(null); setSubmitErrorCrs([]);
    try {
      await axios.post(`${API}/versions/${versionId}/submit/${myTeamId}`, {}, { headers });
      setSubmissionDone(true);
    } catch (e: any) {
      setSubmitError(e.response?.data?.message ?? 'שגיאה בהגשה');
    } finally { setSubmitting(false); }
  };

  // Matches isCrDone's own per-task check above — a proposal already converted
  // into a real scheduled Task (usedInTaskId set) is done even if its own
  // status field was never flipped to READY, same as everywhere else in this
  // file. Omitting that check here (as this used to) undercounts "ready"
  // relative to every other progress indicator on this screen.
  const totalReady = proposals.filter(p => p.status === 'READY' || p.usedInTaskId).length;
  const doneCrCount = crGroups.filter(([cr]) => isCrDone(cr)).length;
  const canSubmit = crGroups.length > 0 && doneCrCount === crGroups.length;

  // Filter users to team members only
  const teamUsers = useMemo(() => {
    if (!myTeamId || !teams.length) return users;
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (!myTeam?.members?.length) return users;
    const memberIds = new Set((myTeam.members as any[]).map((m: any) => m.user.id));
    const filtered = users.filter(u => memberIds.has(u.id));
    return filtered.length > 0 ? filtered : users;
  }, [myTeamId, teams, users]);

  // Allowed responsible teams based on phase:
  // Phase 1: only own team
  // Phase 2/3 (HOTNET/HOT, night testing): own team + QA/testing teams
  // Phase 4 (morning after): own team + QA + operations teams
  const allowedTeams = useMemo(() => {
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    // Always restricted to own team + QA/Operations (per phase) — never every
    // team in the org, even if myTeam can't be resolved yet.
    const base: any[] = myTeam ? [myTeam] : [];
    const addUnique = (t: any) => { if (!base.find(b => b.id === t.id)) base.push(t); };
    if (form.phase === 2 || form.phase === 3 || form.phase === 4) {
      teams.filter((t: any) => t.active && (
        t.name.toLowerCase().includes('qa') || t.name.includes('בדיקות')
      )).forEach(addUnique);
    }
    if (form.phase === 4) {
      teams.filter((t: any) => t.active && t.name.includes('תפעול')).forEach(addUnique);
    }
    return base;
  }, [form.phase, myTeamId, teams]);

  // Users of the selected responsible team
  const responsibleTeamUsers = useMemo(() => {
    const respId = form.responsibleTeamId || myTeamId;
    if (!respId) return teamUsers;
    const respTeam = teams.find((t: any) => t.id === respId);
    if (!respTeam?.members?.length) return teamUsers;
    const members = (respTeam.members as any[]).map((m: any) => m.user).filter(Boolean);
    return members.length > 0 ? members : teamUsers;
  }, [form.responsibleTeamId, myTeamId, teams, teamUsers]);

  // Members of the team submitting the proposal (used for the bulk "הפק משימות" extract modal —
  // independent of the single-add form's responsibleTeamId, which shouldn't leak in here).
  const myTeamMembers = useMemo(() => {
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    const members = (myTeam?.members as any[] | undefined)?.map((m: any) => m.user).filter(Boolean);
    return members && members.length > 0 ? members : teamUsers;
  }, [myTeamId, teams, teamUsers]);

  // Apps for this team — DB first, then static map, then all. Always ends with "אחר".
  const teamAppList = useMemo(() => {
    const withOther = (list: string[]) =>
      list.includes('אחר') ? list : [...list, 'אחר'];
    const myTeam = teams.find((t: any) => t.id === myTeamId);
    if (myTeam?.apps?.length) return withOther(myTeam.apps as string[]);
    const staticApps = TEAM_APPS[myTeamName];
    if (staticApps) return withOther(staticApps);
    return APPS; // all apps (includes 'אחר')
  }, [myTeamId, myTeamName, teams]);


  // ── Form modal ─────────────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="fixed inset-0 z-[3000] bg-[--overlay] [--overlay:theme(colors.black/45%)]" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) cancelForm(); }}>
      <div className="fixed left-1/2 top-1/2 flex max-h-[84vh] w-[760px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-card shadow-floating">
        {/* Panel header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <button onClick={cancelForm} className="rounded px-1.5 py-0.5 text-xl leading-none text-subtle-foreground">✕</button>
          <span className="text-base font-bold text-foreground">{editId ? 'עריכת משימה' : 'פרטי משימה'}</span>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">

          {/* שם משימה */}
          <div>
            <label className={labelClass}>שם משימה <span className="text-danger">*</span></label>
            <input
              autoFocus
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className={inputClass(!form.title.trim())}
              placeholder="תאר את הצעד שיש לבצע..."
            />
          </div>

          {/* CR מקושר */}
          <div>
            <label className={labelClass}>פיתוחים בגרסה (CR)</label>
            {form.isFree ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2.5 text-[15px] text-muted-foreground">
                ללא CR — משימה תשתיתית / כללית
              </div>
            ) : form.crNumber && form.crLabel ? (
              <div className="flex items-center gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2.5">
                <span className="flex-shrink-0 rounded-sm bg-foreground px-2 py-0.5 font-mono text-sm font-bold text-white">
                  {form.crNumber}
                </span>
                <span className="text-[15px] font-semibold text-info">{form.crLabel.replace(`${form.crNumber} - `, '')}</span>
              </div>
            ) : (
              <>
                <input
                  value={crSearch}
                  onChange={e => {
                    const val = e.target.value;
                    setCrSearch(val);
                    const match = crItems.find(c => c.id === val);
                    if (match) setForm(f => ({ ...f, crNumber: match.id, crLabel: match.label }));
                    else setForm(f => ({ ...f, crNumber: val, crLabel: '' }));
                  }}
                  list="tl-cr-datalist"
                  placeholder="הקלד CR# (Enter לחץ ‏↵ להקש)"
                  className={inputClass()}
                />
                <datalist id="tl-cr-datalist">
                  {crItems.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </datalist>
                {form.crLabel && (
                  <div className="mt-1 text-sm text-success">✓ {form.crLabel}</div>
                )}
              </>
            )}
          </div>

          {/* שלב | תת-שלב */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>שלב <span className="text-danger">*</span></label>
              <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: parseInt(e.target.value), subPhaseId: '', responsibleTeamId: myTeamId, assignedUserName: '' }))} className={inputClass()}>
                {(Object.keys(phaseLabels).length > 0
                  ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b)
                  : [1, 2, 3, 4]
                ).map(ph => <option key={ph} value={ph}>{phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>תת-שלב</label>
              {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).length > 0 ? (
                <select value={form.subPhaseId} onChange={e => setForm(f => ({ ...f, subPhaseId: e.target.value }))}
                  className={inputClass(false, form.subPhaseId ? 'bg-info/10' : undefined)}>
                  <option value="">-- בחר --</option>
                  {subPhaseOpts.filter(sp => sp.phaseOrderIndex === form.phase).map(sp => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </select>
              ) : (
                <div className="rounded-md border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">אין תת-שלבים</div>
              )}
            </div>
          </div>

          {/* סוג פעולה | מערכת */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>סוג פעולה <span className="text-danger">*</span></label>
              <select value={form.actionType} onChange={e => {
                const val = e.target.value;
                const currentTitle = form.title.trim();
                // Only auto-fill the title while it's still empty or untouched
                // (equal to the previous actionType) — never overwrite a title
                // the user actually typed themselves, and never prompt about it.
                const titleIsAutoFilled = currentTitle === form.actionType;
                if (!currentTitle || titleIsAutoFilled) {
                  setForm(f => ({ ...f, actionType: val, title: val }));
                } else {
                  setForm(f => ({ ...f, actionType: val }));
                }
              }} className={inputClass(!form.actionType)}>
                <option value="">-- בחר --</option>
                {ACTION_TYPE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>אפליקציה <span className="text-danger">*</span></label>
              <select value={form.app} onChange={e => setForm(f => ({ ...f, app: e.target.value }))}
                className={inputClass(!form.app)}>
                <option value="">-- בחר --</option>
                {teamAppList.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* צוות אחראי | אחראי */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>צוות אחראי</label>
              <select
                value={allowOtherTeam ? (form.responsibleTeamId || myTeamId) : myTeamId}
                disabled={!allowOtherTeam}
                onChange={e => setForm(f => ({ ...f, responsibleTeamId: e.target.value, assignedUserName: '' }))}
                className={inputClass(false, !allowOtherTeam ? 'bg-muted text-muted-foreground cursor-not-allowed' : undefined)}
              >
                {(allowOtherTeam ? allowedTeams : allowedTeams.filter((t: any) => t.id === myTeamId))
                  .map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="mt-1.5 flex items-center gap-2">
                <input type="checkbox" id="allow-other-team" checked={allowOtherTeam}
                  onChange={e => {
                    const checked = e.target.checked;
                    setAllowOtherTeam(checked);
                    if (!checked) setForm(f => ({ ...f, responsibleTeamId: myTeamId, assignedUserName: '' }));
                  }}
                  className="h-3.5 w-3.5 cursor-pointer" />
                <label htmlFor="allow-other-team" className="cursor-pointer text-sm text-muted-foreground">
                  אפשר לבחור צוות אחר
                </label>
              </div>
              {allowOtherTeam && (form.phase === 2 || form.phase === 3) && (
                <div className="mt-1 text-sm text-subtle-foreground">
                  ניתן לשייך לצוות QA לביצוע בדיקות
                </div>
              )}
              {allowOtherTeam && form.phase === 4 && (
                <div className="mt-1 text-sm text-subtle-foreground">
                  ניתן לשייך לצוות QA / תפעול לבקרות בוקר
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>אחראי <span className="text-danger">*</span></label>
              <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))}
                className={inputClass(!form.assignedUserName)}>
                <option value="">-- בחר --</option>
                {responsibleTeamUsers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
              </select>
            </div>
          </div>

          {/* משך */}
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <div>
              <label className={labelClass}>משך (דק') <span className="text-danger">*</span></label>
              <input type="number" min={1} value={form.estimatedMins}
                onChange={e => setForm(f => ({ ...f, estimatedMins: e.target.value }))}
                className={inputClass(!form.estimatedMins)}
                placeholder="10" />
            </div>
          </div>

          {/* הערות */}
          <div>
            <label className={labelClass}>הערות כלליות</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className={inputClass(false, 'h-[72px] resize-y')}
              placeholder="פרמטרים, הוראות מיוחדות, תלויות..." />
          </div>

          {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-[15px] text-danger">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 gap-2.5 justify-start border-t border-border bg-card px-5 py-3.5">
          <Button onClick={save} disabled={saving} loading={saving} className="px-6 text-[15px]">
            {saving ? 'שומר...' : editId ? 'שמור שינויים' : 'הוסף משימה'}
          </Button>
          <Button variant="secondary" onClick={cancelForm} className="px-5 text-[15px]">
            ביטול
          </Button>
        </div>
      </div>
    </div>
  );

  // ── Proposal row ────────────────────────────────────────────────────────────
  // Tasks are gated by the whole-team `locked` flag, not a per-CR submission
  // lock: a per-CR lock deadlocked once (a task created by the very save that
  // submits its plan could end up attached to an already-locked plan with no
  // way to mark it ready) — confirmCrPlan instead bounces the user to this tab
  // when a task still needs approving before it lets the plan be confirmed.
  const renderRow = (p: Proposal) => (
    <div key={p.id} className="mb-[6px] overflow-hidden rounded-lg" style={{
      background: p.usedInTaskId ? C.successBg : C.bgNested,
      border: `1px solid ${p.usedInTaskId ? C.success + '50' : C.border}`,
    }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="shrink-0 whitespace-nowrap rounded-full px-[10px] py-0.5 text-[13px] font-semibold" style={{
          background: PHASE_BADGE[p.phase]?.bg, color: PHASE_BADGE[p.phase]?.color,
        }}>
          {(phaseLabels[p.phase] || PHASE_LABELS[p.phase])?.split(' — ')[1] || `שלב ${p.phase}`}
        </span>
        <span className="flex-1 text-[15px] font-semibold text-foreground">{p.title}</span>
        {p.usedInTaskId ? (
          <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-success">✅ בתוכנית</span>
        ) : locked ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="whitespace-nowrap text-[13px] font-bold" style={{ color: p.status === 'READY' ? C.success : C.warning }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </span>
            <button onClick={() => openEdit(p)}
              className="rounded-md border px-2 py-0.5 text-[13px] font-semibold" style={{ background: C.warningBg, color: C.warning, borderColor: `${C.warning}50` }}>
              ערוך
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => toggleStatus(p)} className="whitespace-nowrap rounded-full px-[10px] py-0.5 text-[13px] font-semibold" style={{
              background: p.status === 'READY' ? C.success : C.warning, color: C.textInverse,
            }}>
              {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
            </button>
            <button onClick={() => openEdit(p)}
              className="rounded-md border px-2 py-0.5 text-[13px] font-semibold" style={{ background: C.warningBg, color: C.warning, borderColor: `${C.warning}50` }}>
              ערוך
            </button>
            <button onClick={() => remove(p)}
              className="rounded-md border px-2 py-0.5 text-[13px] font-semibold" style={{ background: C.dangerBg, color: C.danger, borderColor: `${C.danger}50` }}>
              מחק
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4 border-t px-3 pb-2 pt-[5px] text-sm" style={{
        borderColor: C.border,
        background: p.usedInTaskId ? C.successBg : C.bgCard, color: C.textSecondary,
      }}>
        <span><span className="text-subtle-foreground">מערכת: </span>{p.app || <span className="text-subtle-foreground">לא הוזן</span>}</span>
        {p.actionType && <span className="rounded-sm bg-info-bg px-[7px] py-px text-[13px] font-semibold text-info">{p.actionType}</span>}
        <span><span className="text-subtle-foreground">משך: </span>{p.estimatedMins ? `${p.estimatedMins} דק'` : <span className="text-subtle-foreground">לא הוזן</span>}</span>
        <span><span className="text-subtle-foreground">עובד אחראי: </span>{p.assignedUserName || <span className="text-subtle-foreground">לא הוזן</span>}</span>
        {p.notes && <span className="italic text-muted-foreground">📝 {cleanHtmlText(p.notes)}</span>}
      </div>
    </div>
  );

  // ── Shared per-action editor card ────────────────────────────────────────────
  // Used by Section 2 (regular CRs) and by TARGET CR defect rows — a TARGET
  // defect's linked action is just another entry in the same CrPlan.actions
  // array (tagged via sourceDefectId instead of added by hand), so both get
  // the exact same rich editor rather than two different UIs for "an action".
  const depTaskTitle = (taskId: string) => frameworkTasks.find(t => t.id === taskId)?.title;
  const toggleDepPhase = (ph: number) => setDepPicker(prev => {
    if (!prev) return prev;
    const next = new Set(prev.openPhases);
    if (next.has(ph)) next.delete(ph); else next.add(ph);
    return { ...prev, openPhases: next };
  });
  const actionCardMiniSelClass = 'rounded-sm border border-border bg-card px-[10px] py-1.5 text-xs text-foreground';
  const actionCardMiniTaClass = 'w-full box-border resize-none overflow-hidden rounded-sm border border-border bg-card px-[10px] py-2 text-[13px] text-foreground min-h-[42px]';
  const autoGrowAction = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const renderActionCard = (a: CrPlanAction, idx: number, onChange: (patch: Partial<CrPlanAction>) => void, onRemove: () => void) => (
    <div key={a.id ?? `new-${idx}`} className="mb-[10px] rounded-md px-[14px] py-3" style={{ background: C.bgNested }}>
      <div className="mb-2 flex gap-2">
        <select value={a.actionType} onChange={e => onChange({ actionType: e.target.value })} className={actionCardMiniSelClass}>
          {ACTION_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={onRemove} className="text-[13px] text-danger">הסר</button>
      </div>
      <textarea value={a.description} onInput={autoGrowAction} onChange={e => onChange({ description: e.target.value })}
        className={cn(actionCardMiniTaClass, 'mb-2')} placeholder="תאר את הפעולה שיש לבצע..." />
      <div className="mb-2 flex flex-wrap gap-[6px]">
        {phaseOptions.map(ph => {
          const fullLabel = phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`;
          const shortLabel = fullLabel.split(' — ')[1] || fullLabel;
          const sel = a.phase === ph;
          return (
            <span key={ph} title={fullLabel}
              onClick={() => onChange({ phase: ph, subPhaseId: '' })}
              className="cursor-pointer rounded-full border px-[10px] py-[3px] text-[11px] font-bold"
              style={{
                background: sel ? GOLIVE : C.bgCard,
                borderColor: sel ? GOLIVE : C.borderEm,
                color: sel ? '#fff' : C.textMuted,
              }}>
              {shortLabel}
            </span>
          );
        })}
      </div>
      {subPhaseOpts.filter(sp => sp.phaseOrderIndex === a.phase).length > 0 && (
        <select value={a.subPhaseId || ''} onChange={e => onChange({ subPhaseId: e.target.value })}
          className={cn(actionCardMiniSelClass, 'mb-2 w-full box-border')}>
          <option value="">תת-שלב מדוייק — לא נבחר (ישובץ בתחילת השלב)</option>
          {subPhaseOpts.filter(sp => sp.phaseOrderIndex === a.phase).map(sp => (
            <option key={sp.id} value={sp.id}>{sp.name}</option>
          ))}
        </select>
      )}
      <div className="mb-2 grid grid-cols-3 gap-2">
        <select value={a.system || ''} onChange={e => onChange({ system: e.target.value || undefined })} className={actionCardMiniSelClass}>
          <option value="">מערכת — ללא</option>
          {teamAppList.map((app: string) => <option key={app} value={app}>{app}</option>)}
        </select>
        <input type="number" min={1} value={a.estimatedMins ?? ''} onChange={e => onChange({ estimatedMins: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="משך זמן משוער (דק')" className={cn(actionCardMiniSelClass, 'w-full box-border')} />
        <select value={a.ownerName || ''} onChange={e => onChange({ ownerName: e.target.value })} className={actionCardMiniSelClass}>
          <option value="">אחראי — ללא</option>
          {teamUsers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
        </select>
      </div>

      {/* תלות לוגית — בורר מתקפל שלב ← תת-שלב ← משימה. תלות = "חייבת להסתיים קודם". */}
      <div className="mb-[6px]">
        <div onClick={() => setDepPicker(p => p?.actionIdx === idx ? null : { actionIdx: idx, openPhases: new Set() })}
          className={cn(actionCardMiniSelClass, 'flex w-full box-border cursor-pointer items-center justify-between')}>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: a.dependsOnTaskId ? C.textPrimary : C.textMuted }}>
            {a.dependsOnTaskId ? `תלות: ${depTaskTitle(a.dependsOnTaskId) || '—'}` : 'תלות לוגית — לחץ לבחירת משימה מהתוכנית'}
          </span>
          <span className="ms-[6px] shrink-0 text-subtle-foreground">{depPicker?.actionIdx === idx ? '▴' : '▾'}</span>
        </div>
        {depPicker?.actionIdx === idx && (
          <div className="mt-1 max-h-[220px] overflow-y-auto rounded-sm border border-border bg-card">
            <div onClick={() => { onChange({ dependsOnTaskId: undefined }); setDepPicker(null); }}
              className="cursor-pointer border-b px-[10px] py-[7px] text-xs text-subtle-foreground" style={{ borderColor: C.bgNested }}>
              ✕ ללא תלות במשימה קיימת
            </div>
            {frameworkTasksByPhase.map(([phaseOrderIndex, { phaseLabel, bySubPhase }]) => {
              const isOpen = depPicker.openPhases.has(phaseOrderIndex);
              const taskCount = Array.from(bySubPhase.values()).reduce((n, s) => n + s.tasks.length, 0);
              return (
                <div key={phaseOrderIndex}>
                  <div onClick={() => toggleDepPhase(phaseOrderIndex)} className="flex cursor-pointer justify-between px-[10px] py-[7px] text-xs font-semibold text-muted-foreground" style={{ background: C.bgNested }}>
                    <span>{phaseLabel} ({taskCount})</span>
                    <span>{isOpen ? '▴' : '▾'}</span>
                  </div>
                  {isOpen && Array.from(bySubPhase.entries()).map(([subKey, sub]) => (
                    <div key={subKey}>
                      <div className="px-3 pb-0.5 pt-[5px] text-[10.5px] uppercase text-subtle-foreground">{sub.subPhaseName}</div>
                      {sub.tasks.map((t, ti) => (
                        <div key={`${t.id}-${ti}`} onClick={() => { onChange({ dependsOnTaskId: t.id }); setDepPicker(null); }}
                          className="cursor-pointer px-4 py-[5px] text-xs"
                          style={{
                            color: a.dependsOnTaskId === t.id ? GOLIVE : C.textPrimary,
                            fontWeight: a.dependsOnTaskId === t.id ? WEIGHT.semibold : WEIGHT.normal,
                            background: a.dependsOnTaskId === t.id ? `${GOLIVE}14` : 'transparent',
                          }}>
                          {t.title}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <input value={a.dependencyNote || ''} onChange={e => onChange({ dependencyNote: e.target.value })}
        placeholder="הערת תלות נוספת / תלות שאינה משימה בתוכנית..." className={cn(actionCardMiniSelClass, 'w-full box-border')} />
    </div>
  );

  // ── TARGET CR — dedicated defect-approval gate, replaces the regular
  // impact/actions/monitoring/rollback form entirely for CRs whose label/type
  // contains "TARGET" (an umbrella CR wrapping a batch of QC defects for a
  // team, not a real development CR). A defect marked "requires special
  // implementation" gets a real entry in this same CR's own Section-2 actions
  // array (tagged via sourceDefectId) — same editor (renderActionCard above),
  // same save/derive path as any other action, just triggered per-defect
  // instead of by hand. See backend/src/target-cr for the data model. ──
  const loadTargetReview = useCallback((crNumber: string, teamId: string) => {
    setTargetReviewLoading(prev => ({ ...prev, [crNumber]: true }));
    axios.get(`${API}/target-cr/version/${versionId}/cr/${crNumber}`, { headers, params: { teamId } })
      .then(r => {
        setTargetReviewByCr(prev => ({ ...prev, [crNumber]: r.data }));
        setTargetReviewError(prev => { const next = { ...prev }; delete next[crNumber]; return next; });
      })
      .catch(e => setTargetReviewError(prev => ({ ...prev, [crNumber]: e.response?.data?.message ?? 'שגיאה בטעינת תכולת ה-TARGET' })))
      .finally(() => setTargetReviewLoading(prev => ({ ...prev, [crNumber]: false })));
  }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the TARGET defect list the moment a TARGET CR becomes selected —
  // renderTargetCrGate itself stays a pure render (no side effects), so this
  // is the one place that kicks the fetch off.
  useEffect(() => {
    if (!selectedCr) return;
    const plan = crPlans[selectedCr];
    const label = getCrLabel(selectedCr) || plan?.crLabel || '';
    const isTarget = /target/i.test(label) || /target/i.test(plan?.crType || '');
    if (!isTarget) return;
    if (targetReviewByCr[selectedCr] || targetReviewLoading[selectedCr]) return;
    loadTargetReview(selectedCr, teamIdOverride || myTeamId);
  }, [selectedCr, crPlans, myTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "תוקנו / פתוחות / פתוחות ומאושרות לעלייה" — every CR gets this (not just
  // TARGET ones), fetched once per CR the first time its plan form is opened.
  useEffect(() => {
    if (!selectedCr || !myTeamLabel) return;
    if (crDefectIndicatorsByCr[selectedCr] || crDefectIndicatorsLoading[selectedCr]) return;
    setCrDefectIndicatorsLoading(prev => ({ ...prev, [selectedCr]: true }));
    axios.get(`${API}/qc/cr-defect-indicators`, { headers, params: { versionId, crNumber: selectedCr, teamName: myTeamLabel } })
      .then(r => setCrDefectIndicatorsByCr(prev => ({ ...prev, [selectedCr]: r.data })))
      .catch(() => setCrDefectIndicatorsByCr(prev => ({ ...prev, [selectedCr]: { fixed: [], open: [], openApproved: [] } })))
      .finally(() => setCrDefectIndicatorsLoading(prev => ({ ...prev, [selectedCr]: false })));
  }, [selectedCr, myTeamLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchTargetDefect = (crNumber: string, row: TargetDefectRow, patch: Partial<TargetDefectRow>, teamId: string) => {
    const current = targetReviewByCr[crNumber];
    if (!row.id || !current) return;
    setTargetReviewByCr(prev => ({ ...prev, [crNumber]: { ...current, defects: current.defects.map(d => d.id === row.id ? { ...d, ...patch } : d) } }));
    axios.patch(`${API}/target-cr/defect/${row.id}`, patch, { headers }).catch(() => loadTargetReview(crNumber, teamId));

    // Keep the linked action in the very same crPlanForms[crNumber].actions
    // array this defect's checkbox controls — added the moment it's checked,
    // removed the moment it's unchecked. Only persisted to the server (and
    // turned into a real derived TaskProposal) on save/approve, exactly like
    // any other Section-2 action — nothing here talks to the server directly.
    if ('requiresSpecialImplementation' in patch) {
      const f = crPlanForms[crNumber] || emptyCrPlanForm();
      if (patch.requiresSpecialImplementation) {
        if (!f.actions.some(a => a.sourceDefectId === row.id)) {
          setCrPlanForms(prev => ({
            ...prev,
            [crNumber]: {
              ...(prev[crNumber] || emptyCrPlanForm()), crType: 'TARGET',
              actions: [...f.actions, {
                actionType: ACTION_TYPE_OPTIONS[0],
                description: `DEF-${row.defectId}${row.title ? `: ${row.title}` : ''}`,
                phase: 2, sourceDefectId: row.id ?? undefined,
              }],
            },
          }));
        }
      } else {
        setCrPlanForms(prev => ({
          ...prev,
          [crNumber]: { ...(prev[crNumber] || emptyCrPlanForm()), actions: f.actions.filter(a => a.sourceDefectId !== row.id) },
        }));
      }
      setDirtyCrs(prev => new Set(prev).add(crNumber));
    }
  };

  const approveTargetCr = async (crNumber: string, reviewId: string, teamId: string) => {
    setTargetApproving(crNumber);
    try {
      // Persist whatever Section-2 actions were built up for this CR's
      // defects first — approve() on the server materializes real
      // TaskProposals from whatever's already saved, so an edit made a
      // second ago but never saved would otherwise be silently skipped.
      await saveCrPlan(crNumber, { crType: 'TARGET' });
      await axios.patch(`${API}/target-cr/${reviewId}/approve`, {}, { headers });
      loadTargetReview(crNumber, teamId);
      await fetchProposals();
    } catch (e: any) {
      setTargetReviewError(prev => ({ ...prev, [crNumber]: e.response?.data?.message ?? 'שגיאה באישור' }));
    } finally {
      setTargetApproving(null);
    }
  };

  const renderTargetCrGate = (crNumber: string, crLabel: string, teamId: string) => {
    const data = targetReviewByCr[crNumber];
    const error = targetReviewError[crNumber];
    if (!data) {
      return error
        ? <div className="rounded-md p-4 text-sm" style={{ background: C.dangerBg, color: C.danger }}>{error}</div>
        : <div className="p-10 text-center text-[15px] text-subtle-foreground">⏳ טוען תכולת TARGET...</div>;
    }

    const { review, teamName, defects } = data;
    const gateReady = review.gateChecklist1 && review.gateChecklist2 && review.gateChecklist3;
    const specialCount = defects.filter(d => d.requiresSpecialImplementation).length;
    const managementCount = defects.filter(d => d.importantToManagement).length;
    // Same lock semantics as the regular CR-plan's manager-unlock: approval
    // itself never flips back to false — unlocking only re-enables the
    // inputs, with an explicit "finish editing" to re-lock.
    const lockedForEdit = review.approved && !unlockedForEdit.has(crNumber);
    const f = crPlanForms[crNumber] || emptyCrPlanForm();
    const approving = targetApproving === crNumber;

    const patchGate = (patch: Partial<{ gateChecklist1: boolean; gateChecklist2: boolean; gateChecklist3: boolean }>) => {
      setTargetReviewByCr(prev => ({ ...prev, [crNumber]: { ...data, review: { ...data.review, ...patch } } }));
      axios.patch(`${API}/target-cr/${review.id}/gate`, patch, { headers }).catch(() => loadTargetReview(crNumber, teamId));
    };

    return (
      <div>
        <div className="mb-[18px] rounded-lg px-[22px] py-[18px]" style={{ background: `${GOLIVE}12`, borderColor: `${GOLIVE}40`, borderWidth: 1, borderStyle: 'solid' }}>
          <div className="mb-[6px] text-[19px] font-bold text-foreground">תכולת TARGET לצוות {teamName}</div>
          <div className="text-sm leading-[1.5] text-muted-foreground">
            נמצאו {defects.length} תקלות TARGET המשויכות לצוות {teamName} ונכללות ב-{crLabel || crNumber}
          </div>
        </div>

        {review.approved && (
          <div className="mb-4 flex items-center gap-3 rounded-md px-[18px] py-3" style={{ background: C.successBg, border: `1px solid ${C.success}40` }}>
            <div className="flex-1 text-sm font-semibold leading-[1.5]" style={{ color: C.success }}>
              ✓ CR TARGET אושר ע"י {review.approvedByName} {review.approvedAt && `· ${formatDateTime(review.approvedAt)}`}
              {specialCount > 0 && ` · ${specialCount} תקלות דורשות הטמעה מיוחדת`}
              {managementCount > 0 && ` · ${managementCount} תקלות סומנו כחשובות`}
            </div>
            {lockedForEdit ? (
              <button onClick={() => setUnlockedForEdit(prev => new Set(prev).add(crNumber))} className="shrink-0 rounded-sm px-[14px] py-[7px] text-[13px] font-semibold"
                style={{ background: 'transparent', border: `1px solid ${C.success}`, color: C.success }}>
                ✏️ פתח לעריכה
              </button>
            ) : (
              <button onClick={() => setUnlockedForEdit(prev => { const next = new Set(prev); next.delete(crNumber); return next; })} className="shrink-0 rounded-sm px-[14px] py-[7px] text-[13px] font-semibold text-white"
                style={{ background: C.success, border: 'none' }}>
                🔒 סיים עריכה
              </button>
            )}
          </div>
        )}

        <div className={cn('mb-[18px] overflow-hidden rounded-lg border border-border bg-card', lockedForEdit && 'pointer-events-none opacity-60')}>
          <div className="flex items-center gap-[10px] px-4 py-[11px] text-[12.5px] font-bold uppercase tracking-[.03em] text-muted-foreground" style={{ background: C.bgNested }}>
            <span className="w-5 shrink-0">✓</span>
            <span className="w-[100px] shrink-0">תקלה</span>
            <span className="flex-1">תיאור</span>
            <span className="w-[280px] shrink-0">סימון מיוחד</span>
          </div>
          {defects.map(d => {
            const actionIdx = f.actions.findIndex(a => a.sourceDefectId === d.id);
            return (
              <div key={d.defectId} className="border-t" style={{ borderColor: C.bgNested }}>
                <div className="flex items-center gap-[10px] px-4 py-[14px]">
                  <span className="w-5 shrink-0 text-[15px] font-bold" style={{ color: C.success }}>✓</span>
                  <span className="w-[100px] shrink-0 font-mono text-[13px] font-semibold" style={{ color: targetDefectStatusColor(d.status) }}>DEF-{d.defectId}</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[14.5px]" style={{ color: targetDefectStatusColor(d.status) }} title={`${d.title} (${d.status})`}>{d.title}</span>
                  <div className="flex w-[280px] shrink-0 flex-col gap-[6px]">
                    <label className="flex cursor-pointer items-center gap-[7px] text-[13.5px] text-foreground">
                      <input type="checkbox" checked={d.requiresSpecialImplementation} className="h-4 w-4 cursor-pointer"
                        onChange={e => patchTargetDefect(crNumber, d, { requiresSpecialImplementation: e.target.checked }, teamId)} />
                      דורשת הטמעה מיוחדת
                    </label>
                    <label className="flex cursor-pointer items-center gap-[7px] text-[13.5px] text-foreground">
                      <input type="checkbox" checked={d.importantToManagement} className="h-4 w-4 cursor-pointer"
                        onChange={e => patchTargetDefect(crNumber, d, { importantToManagement: e.target.checked }, teamId)} />
                      תקלה חשובה
                    </label>
                  </div>
                </div>
                {d.requiresSpecialImplementation && actionIdx >= 0 && (
                  <div className="ps-4 pe-[46px] pb-[14px]" style={{ background: C.bgNested }}>
                    {renderActionCard(
                      f.actions[actionIdx], actionIdx,
                      patch => setCrPlanForms(prev => {
                        const pf = prev[crNumber] || emptyCrPlanForm();
                        return { ...prev, [crNumber]: { ...pf, actions: pf.actions.map((a, i) => i === actionIdx ? { ...a, ...patch } : a) } };
                      }),
                      () => patchTargetDefect(crNumber, d, { requiresSpecialImplementation: false }, teamId),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-border bg-card px-5 py-[18px]">
          {!lockedForEdit && (
            <div className="mb-4 flex flex-col gap-[10px]">
              <label className="flex cursor-pointer items-center gap-[9px] text-[14.5px] text-foreground">
                <input type="checkbox" checked={review.gateChecklist1} className="h-[17px] w-[17px] cursor-pointer" onChange={e => patchGate({ gateChecklist1: e.target.checked })} />
                בדקתי את רשימת התקלות
              </label>
              <label className="flex cursor-pointer items-center gap-[9px] text-[14.5px] text-foreground">
                <input type="checkbox" checked={review.gateChecklist2} className="h-[17px] w-[17px] cursor-pointer" onChange={e => patchGate({ gateChecklist2: e.target.checked })} />
                לא חסרה תקלה שאמורה להיכלל
              </label>
              <label className="flex cursor-pointer items-center gap-[9px] text-[14.5px] text-foreground">
                <input type="checkbox" checked={review.gateChecklist3} className="h-[17px] w-[17px] cursor-pointer" onChange={e => patchGate({ gateChecklist3: e.target.checked })} />
                לא מופיעות תקלות שאינן מוכרות לי
              </label>
            </div>
          )}
          <div className="flex gap-[9px]">
            {!lockedForEdit && (
              <button onClick={() => saveCrPlan(crNumber, { crType: 'TARGET' })} disabled={savingPlan === crNumber}
                className={cn('rounded-md border border-border px-[18px] py-[10px] text-sm font-semibold text-muted-foreground', savingPlan === crNumber ? 'cursor-not-allowed' : 'cursor-pointer')}
                style={{ background: savingPlan === crNumber ? C.textDisabled : C.bgNested }}>
                {savingPlan === crNumber ? 'שומר...' : '💾 שמור טיוטה'}
              </button>
            )}
            {/* Not just "!review.approved" — an already-approved CR reopened via
                "✏️ פתח לעריכה" needs this too, otherwise a newly-added/edited
                action after unlock has no way back into syncDerivedProposals
                (only this button's click ever triggers it) and just sits saved
                with no derived task, which is exactly the bug this fixes. */}
            {!lockedForEdit && (
              <button onClick={() => approveTargetCr(crNumber, review.id, teamId)} disabled={!gateReady || approving}
                className={cn('flex-1 rounded-md border-none p-[13px] text-[15px] font-bold', gateReady && !approving ? 'cursor-pointer' : 'cursor-not-allowed')}
                style={{
                  background: gateReady ? GOLIVE : C.bgNested, color: gateReady ? '#fff' : C.textDisabled,
                }}>
                {approving ? 'מאשר…' : review.approved ? '🔄 עדכן משימות ואשר מחדש' : '✓ אשר CR TARGET'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── CrPlan form content ──────────────────────────────────────────────────────
  // ── Section-1 gate — "האם קיימת השפעה תפעולית מיוחדת ל-CR זה?" ──────────────
  const renderGate = (crNumber: string) => (
    <div className="mx-auto max-w-[620px] rounded-xl border border-border bg-card px-[26px] py-7 text-center shadow-sm">
      <div className="mb-5 text-[17px] font-extrabold leading-[1.4] text-foreground">
        האם קיימת השפעה תפעולית מיוחדת ל-CR זה?
      </div>
      <div className="flex justify-center gap-3">
        <button onClick={() => answerGate(crNumber, false)}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}
          className="max-w-[220px] flex-1 cursor-pointer rounded-lg p-[18px] text-sm font-bold transition-transform duration-fast"
          style={{
            border: '2px solid rgba(22,163,74,.25)', background: C.successBg, color: C.success,
          }}>
          לא — הטמעה רגילה
        </button>
        <button onClick={() => answerGate(crNumber, true)}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}
          className="max-w-[220px] flex-1 cursor-pointer rounded-lg p-[18px] text-sm font-bold transition-transform duration-fast"
          style={{
            border: '2px solid rgba(217,119,6,.3)', background: C.warningBg, color: C.warning,
          }}>
          כן — יש פרטים למלא
        </button>
      </div>
    </div>
  );

  // ── Sections 2–7 — accordion form shown once the gate answer is "כן" ────────
  const renderCrPlanForm = (crNumber: string) => {
    const f        = crPlanForms[crNumber] || emptyCrPlanForm();
    const otherCrs = allCrNumbers.filter(c => c !== crNumber);
    const plan     = crPlans[crNumber];
    const submitted = plan?.submissionStatus === 'SUBMITTED' || plan?.submissionStatus === 'APPROVED';
    const lockedForEdit = submitted && !unlockedForEdit.has(crNumber);

    const update = (patch: Partial<CrPlanForm>) => {
      setCrPlanForms(prev => ({ ...prev, [crNumber]: { ...(prev[crNumber] || emptyCrPlanForm()), ...patch } }));
      setDirtyCrs(prev => new Set(prev).add(crNumber));
    };

    const toggleChip = (list: string[], item: string, key: 'changeTypes' | 'prerequisites') => {
      const next = list.includes(item) ? list.filter(x => x !== item) : [...list, item];
      update({ [key]: next } as any);
      if (key === 'changeTypes' && next.length > 0) {
        setPlanValidationError(prev => { const p = { ...prev }; delete p[crNumber]; return p; });
      }
    };

    const updateAction = (idx: number, patch: Partial<CrPlanAction>) =>
      update({ actions: f.actions.map((a, i) => i === idx ? { ...a, ...patch } : a) });
    const removeAction = (idx: number) => {
      update({ actions: f.actions.filter((_, i) => i !== idx) });
      setDepPicker(null);
    };

    const updateMonitoring = (idx: number, patch: Partial<CrPlanMonitoringPoint>) =>
      update({ monitoringPoints: f.monitoringPoints.map((m, i) => i === idx ? { ...m, ...patch } : m) });
    const removeMonitoring = (idx: number) => update({ monitoringPoints: f.monitoringPoints.filter((_, i) => i !== idx) });

    // "תמיד כדאי להציג לראש הצוות את הצוותים המעורבים" — pulled from the real
    // cross-team CR assignment scope (cr-scope endpoint), so the team lead sees
    // every other team actually touching this CR.
    const scope = crScope[crNumber];
    const myTeamLabel = teamNameOverride || myTeamName;
    const involvedTeams = (scope?.teamNames ?? []).filter(t => t !== myTeamLabel);
    // Systems, unlike teams, aren't known ahead of time from cross-team scope —
    // before any action is added, there's no telling which system this team's
    // work will actually touch. So this list is derived only from the "מערכת"
    // tagged on each of this team's own actions (Section 2), not the CR-wide scope.
    const involvedSystems = Array.from(new Set(f.actions.map(a => a.system).filter((s): s is string => !!s)));

    const secHdrClass = 'flex items-center gap-2 border-b border-border bg-muted px-4 py-[10px] text-[12.5px] font-bold text-muted-foreground';
    const secNumClass = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white';
    const secNumStyle: React.CSSProperties = { background: GOLIVE };
    const secClass = 'mb-[10px] overflow-hidden rounded-md border border-border bg-card';
    const secBodyClass = 'px-4 py-[14px]';
    const chipClass = 'cursor-pointer rounded-full px-[11px] py-1 text-[11px] font-semibold border';
    const chipStyle = (selected: boolean): React.CSSProperties => ({
      borderColor: selected ? GOLIVE : C.borderEm,
      background: selected ? `${GOLIVE}24` : C.bgCard,
      color: selected ? GOLIVE : C.textSecondary,
    });
    const miniSelClass = 'rounded-sm border border-border bg-card px-[10px] py-1.5 text-xs text-foreground';
    const miniTaClass = 'w-full box-border resize-none overflow-hidden rounded-sm border border-border bg-card px-[10px] py-2 text-[13px] text-foreground min-h-[42px]';

    return (
      <div>
        {plan?.submissionStatus === 'RETURNED' && plan.returnReason && (
          <div className="mb-3 rounded-md border px-[14px] py-[10px] text-[13px] text-danger" style={{ background: C.dangerBg, borderColor: `${C.danger}40` }}>
            ⚠ התוכנית הוחזרה לתיקון: {plan.returnReason}
          </div>
        )}

        {(involvedSystems.length > 0 || involvedTeams.length > 0) && (
          <div className="mb-3 flex flex-wrap gap-[14px] rounded-md border border-border bg-muted px-[14px] py-2 text-xs">
            {involvedSystems.length > 0 && (
              <div className="flex items-center gap-[6px]">
                <span className="font-semibold text-subtle-foreground">מערכות מעורבות:</span>
                <span className="text-muted-foreground">{involvedSystems.join(', ')}</span>
              </div>
            )}
            {involvedTeams.length > 0 && (
              <div className="flex items-center gap-[6px]">
                <span className="font-semibold text-subtle-foreground">צוותים נוספים מעורבים:</span>
                <span className="text-muted-foreground">{involvedTeams.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {(() => {
          const ind = crDefectIndicatorsByCr[crNumber];
          const indLoading = crDefectIndicatorsLoading[crNumber];
          if (!ind && !indLoading) return null;
          const expanded = expandedDefectBucket[crNumber] ?? null;
          const buckets: { key: 'fixed' | 'open' | 'openApproved'; label: string; color: string }[] = [
            { key: 'fixed', label: 'תוקנו', color: C.success },
            { key: 'open', label: 'פתוחות', color: C.danger },
            { key: 'openApproved', label: 'פתוחות ומאושרות לעלייה', color: C.warning },
          ];
          const list = expanded && ind ? ind[expanded] : [];
          return (
            <div className="mb-3 rounded-md border border-border px-[14px] py-[10px]" style={{ background: C.bgNested }}>
              <div className="flex flex-wrap items-center gap-[18px] text-xs">
                <span className="font-semibold text-subtle-foreground">🪲 תקלות מול CR זה:</span>
                {indLoading && !ind ? (
                  <span className="text-subtle-foreground">טוען...</span>
                ) : ind && buckets.map(b => (
                  <button
                    key={b.key}
                    onClick={() => setExpandedDefectBucket(prev => ({ ...prev, [crNumber]: prev[crNumber] === b.key ? null : b.key }))}
                    className={cn('flex cursor-pointer items-center gap-[5px] border-none bg-transparent p-0', expanded === b.key ? 'font-bold underline' : 'font-normal no-underline')}
                    style={{ color: expanded === b.key ? b.color : C.textSecondary }}
                  >
                    {b.label}: <span className="font-bold" style={{ color: b.color }}>{ind[b.key].length}</span>
                  </button>
                ))}
              </div>
              {expanded && (
                <div className="mt-[10px] flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                  {list.length === 0 ? (
                    <div className="text-xs text-subtle-foreground">אין תקלות ברשימה זו.</div>
                  ) : list.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-[10px] rounded-sm border border-border bg-card px-2 py-[5px] text-xs">
                      <DefectIdBadge id={d.id} />
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{d.title || d.subject}</span>
                      <span className="shrink-0 text-subtle-foreground">{d.status}</span>
                      <span className="shrink-0 text-subtle-foreground" dir="ltr">{d.detectedInRelease} → {d.targetRelease || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {lockedForEdit && (
          <div className="mb-3 flex items-center gap-[10px] rounded-md px-[14px] py-[10px]" style={{ background: C.successBg, border: '1px solid rgba(22,163,74,.3)' }}>
            <span className="flex-1 text-[13px]" style={{ color: '#0F5A2A' }}>✓ התוכנית הוגשה ונעולה לעריכה.</span>
            <button onClick={() => setUnlockedForEdit(prev => new Set(prev).add(crNumber))}
              className="shrink-0 cursor-pointer rounded-md px-[14px] py-1.5 text-[13px] font-bold" style={{ background: C.bgCard, color: C.success, border: `1px solid ${C.success}60` }}>
              ✏️ פתח לעריכה
            </button>
          </div>
        )}

        <div className={cn(lockedForEdit && 'pointer-events-none opacity-60')}>
        {/* Section 1 — מה משתנה */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>1</span>מה משתנה</div>
          <div className={secBodyClass}>
            <div className="flex flex-wrap gap-[6px]">
              {CHANGE_TYPES.map(ct => (
                <span key={ct} className={chipClass} style={chipStyle(f.changeTypes.includes(ct))} onClick={() => toggleChip(f.changeTypes, ct, 'changeTypes')}>{ct}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2 — פעולות מיוחדות */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>2</span>פעולות מיוחדות</div>
          <div className={secBodyClass}>
            {/* Timeline Planning — grouped by day-part (real phase field) then by
                action type ("Activity Container"). Visual grouping only: the
                per-task edit card below is byte-for-byte the same form as before,
                just organized under container headers instead of a flat list. */}
            {PHASE_BUCKETS.map(bucket => {
              const bucketItems = f.actions.map((a, idx) => ({ a, idx })).filter(({ a }) => a.phase === bucket.phase);
              const byType = new Map<string, { a: CrPlanAction; idx: number }[]>();
              for (const item of bucketItems) {
                const key = item.a.actionType || 'אחר';
                if (!byType.has(key)) byType.set(key, []);
                byType.get(key)!.push(item);
              }
              // Monitoring points, unlike actions, aren't grouped by a container
              // type — they live in one collapsible "בקרה" container per phase.
              const bucketMonItems = f.monitoringPoints.map((m, idx) => ({ m, idx })).filter(({ m }) => m.phase === bucket.phase);
              const monContainerKey = `${bucket.phase}-monitoring`;
              const monCollapsed = collapsedContainers.has(monContainerKey);
              return (
                <div key={bucket.phase} className="mb-[18px]">
                  <div className="mb-2 flex items-center gap-[10px]">
                    <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: GOLIVE }}>
                      {bucket.letter}
                    </div>
                    <div>
                      <div className="text-[12.5px] font-extrabold text-foreground">{bucket.title}</div>
                      <div className="text-[10.5px] text-subtle-foreground">{bucket.meta}</div>
                    </div>
                  </div>

                  {byType.size === 0 ? (
                    <div className="px-0.5 pb-[10px] pt-0.5 text-[11.5px] text-subtle-foreground">אין פעולות עדיין בשלב זה</div>
                  ) : (
                    <div className="mb-2 flex flex-col gap-2">
                      {Array.from(byType.entries()).map(([actionType, items]) => {
                        const containerKey = `${bucket.phase}-${actionType}`;
                        const collapsed = collapsedContainers.has(containerKey);
                        const iconMeta = ACTION_TYPE_ICON[actionType] ?? ACTION_TYPE_ICON['אחר'];
                        return (
                          <div key={containerKey} className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
                            <div
                              onClick={() => setCollapsedContainers(prev => {
                                const next = new Set(prev);
                                if (next.has(containerKey)) next.delete(containerKey); else next.add(containerKey);
                                return next;
                              })}
                              className="flex cursor-pointer items-center gap-[10px] px-[14px] py-[10px]">
                              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm text-xs" style={{ background: iconMeta.bg, color: iconMeta.color }}>{iconMeta.icon}</span>
                              <span className="flex-1 text-[12.5px] font-bold text-foreground">{actionType}</span>
                              <span className="rounded-full bg-muted px-[9px] py-0.5 text-[10.5px] font-bold text-subtle-foreground">{items.length} משימות</span>
                              <span className="text-[11px] text-subtle-foreground">{collapsed ? '◂' : '▾'}</span>
                            </div>
                            {!collapsed && (
                              <div className="border-t border-border px-[14px] py-[10px]">
                                {items.map(({ a, idx }) =>
                                  renderActionCard(a, idx, patch => updateAction(idx, patch), () => removeAction(idx))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {bucketMonItems.length > 0 && (
                    <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
                      <div
                        onClick={() => setCollapsedContainers(prev => {
                          const next = new Set(prev);
                          if (next.has(monContainerKey)) next.delete(monContainerKey); else next.add(monContainerKey);
                          return next;
                        })}
                        className="flex cursor-pointer items-center gap-[10px] px-[14px] py-[10px]">
                        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm bg-info-bg text-xs text-info">👁</span>
                        <span className="flex-1 text-[12.5px] font-bold text-foreground">בקרה (Monitoring)</span>
                        <span className="rounded-full bg-muted px-[9px] py-0.5 text-[10.5px] font-bold text-subtle-foreground">{bucketMonItems.length} נקודות</span>
                        <span className="text-[11px] text-subtle-foreground">{monCollapsed ? '◂' : '▾'}</span>
                      </div>
                      {!monCollapsed && (
                        <div className="border-t border-border px-[14px] py-[10px]">
                          {bucketMonItems.map(({ m, idx }) => {
                            const monTeamMembers = teams.find((t: any) => t.id === m.assignedTeamId)?.members?.map((mm: any) => mm.user).filter(Boolean) ?? teamUsers;
                            return (
                              <div key={idx} className="mb-[10px] rounded-md px-[14px] py-3" style={{ background: C.bgNested }}>
                                <div className="mb-2 flex gap-2">
                                  <select value={m.type} onChange={e => updateMonitoring(idx, { type: e.target.value })} className={miniSelClass}>
                                    {MONITORING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <input value={m.name} onChange={e => updateMonitoring(idx, { name: e.target.value })} className={cn(miniSelClass, 'flex-1 box-border font-mono')} placeholder="שם ממשק/עבודה/טבלה" />
                                  <button onClick={() => removeMonitoring(idx)} className="shrink-0 text-[13px] text-danger">הסר</button>
                                </div>
                                <input value={m.note || ''} onChange={e => updateMonitoring(idx, { note: e.target.value })}
                                  className={cn(miniSelClass, 'mb-2 w-full box-border')} placeholder="לוודא ש..." />
                                <div className="mb-2 flex flex-wrap gap-[6px]">
                                  {phaseOptions.map(ph => {
                                    const fullLabel = phaseLabels[ph] || PHASE_LABELS[ph] || `שלב ${ph}`;
                                    const shortLabel = fullLabel.split(' — ')[1] || fullLabel;
                                    const sel = m.phase === ph;
                                    return (
                                      <span key={ph} title={fullLabel} onClick={() => updateMonitoring(idx, { phase: ph })}
                                        className="cursor-pointer rounded-full border px-[10px] py-[3px] text-[11px] font-bold"
                                        style={{
                                          background: sel ? GOLIVE : C.bgCard,
                                          borderColor: sel ? GOLIVE : C.borderEm,
                                          color: sel ? '#fff' : C.textMuted,
                                        }}>
                                        {shortLabel}
                                      </span>
                                    );
                                  })}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <select value={m.assignedTeamId || ''} onChange={e => updateMonitoring(idx, { assignedTeamId: e.target.value || undefined, assignedUserName: undefined })} className={miniSelClass}>
                                    <option value="">צוות אחראי — ללא</option>
                                    {teams.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                  </select>
                                  <select value={m.assignedUserName || ''} onChange={e => updateMonitoring(idx, { assignedUserName: e.target.value || undefined })} className={miniSelClass}>
                                    <option value="">עובד אחראי — ללא</option>
                                    {monTeamMembers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                                  </select>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={() => setTaskWizard({ crNumber, phase: bucket.phase, type: null, step: -1, data: {} })}
                    className="w-full rounded-md border-[1.5px] border-dashed border-border p-2 text-xs font-semibold" style={{ background: 'none', color: GOLIVE }}>
                    + הוספת משימה
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 3 — תנאים מקדימים */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>3</span>תנאים מקדימים</div>
          <div className={secBodyClass}>
            <div className="mb-2 flex flex-wrap gap-[6px]">
              {PREREQUISITE_OPTIONS.map(p => (
                <span key={p} className={chipClass} style={chipStyle(f.prerequisites.includes(p))} onClick={() => toggleChip(f.prerequisites, p, 'prerequisites')}>{p}</span>
              ))}
            </div>
            <input value={f.prerequisitesNote} onChange={e => update({ prerequisitesNote: e.target.value })}
              className={cn(miniSelClass, 'w-full box-border')} placeholder="הערות חופשיות נוספות..." />
          </div>
        </div>

        {/* Section 4 — Rollback */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>4</span>Rollback</div>
          <div className={secBodyClass}>
            <div className="flex items-center gap-[10px]">
              <select value={f.rollbackType} onChange={e => update({ rollbackType: e.target.value })} className={miniSelClass}>
                <option value="">-- בחר סוג Rollback --</option>
                {ROLLBACK_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input value={f.rollbackPlan} onChange={e => update({ rollbackPlan: e.target.value })} className={cn(miniSelClass, 'flex-1')} placeholder="הערות Rollback..." />
            </div>
          </div>
        </div>

        {/* Section 5 — אופן העלייה */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>5</span>אופן העלייה</div>
          <div className={secBodyClass}>
            <div className="flex flex-wrap gap-[6px]">
              <span className={chipClass} style={chipStyle(!f.gradualRollout)} onClick={() => update({ gradualRollout: false })}>🌙 עלייה בליל הגרסה</span>
              <span className={chipClass} style={chipStyle(f.gradualRollout)} onClick={() => update({ gradualRollout: true })}>📶 עלייה מדורגת</span>
            </div>
            {f.gradualRollout && (
              <div className="mt-[10px] flex flex-col gap-[10px]">
                <textarea value={f.gradualDetails} onChange={e => update({ gradualDetails: e.target.value })}
                  className={cn(miniSelClass, 'w-full box-border min-h-[60px] resize-y')}
                  placeholder="שלבי העלייה — מה עולה בכל שלב, ובאיזה סדר..." />
                <div className="flex items-center gap-[10px]">
                  <span className="whitespace-nowrap text-[13px] text-subtle-foreground">תאריך הפעלה:</span>
                  <div className="max-w-[160px]">
                    <DateField value={f.activationDate} onChange={iso => update({ activationDate: iso })} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* תלויות CR (ברמת ה-CR, לא ברמת פעולה בודדת) */}
        {otherCrs.length > 0 && (
          <div className={secClass}>
            <div className={secHdrClass}>תלויות ב-CR-ים אחרים</div>
            <div className={secBodyClass}>
              <div className="flex flex-wrap gap-[6px]">
                {otherCrs.map(cr => (
                  <span key={cr} className={chipClass} style={chipStyle(f.dependsOnCrs.includes(cr))}
                    onClick={() => {
                      const next = f.dependsOnCrs.includes(cr) ? f.dependsOnCrs.filter(x => x !== cr) : [...f.dependsOnCrs, cr];
                      update({ dependsOnCrs: next });
                    }}>
                    {cr}
                  </span>
                ))}
              </div>
              {f.dependsOnCrs.length > 0 && (
                <div className="mt-[10px] flex flex-col gap-[6px]">
                  {f.dependsOnCrs.map(cr => (
                    <div key={cr} className="flex items-center gap-2">
                      <span className="w-[90px] shrink-0 font-mono text-xs text-subtle-foreground">{cr} תלוי ב-</span>
                      <input value={f.dependencyNotes[cr] || ''}
                        onChange={e => update({ dependencyNotes: { ...f.dependencyNotes, [cr]: e.target.value } })}
                        className={cn(miniSelClass, 'flex-1')} placeholder="הסבר את התלות..." />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        </div>

        {/* Section 6 — תקציר וסגירה */}
        <div className={secClass}>
          <div className={secHdrClass}><span className={secNumClass} style={secNumStyle}>6</span>תקציר וסגירה</div>
          <div className={secBodyClass}>
            <div className="mb-[14px] flex flex-col gap-[10px] text-[13px] leading-[1.6] text-muted-foreground">
              <div>• שינויים ב-<strong className="text-foreground">{f.changeTypes.length ? f.changeTypes.join(', ') : '—'}</strong></div>

              <div>
                <div>• <strong className="text-foreground">{f.actions.length} פעולות מיוחדות</strong></div>
                {f.actions.length > 0 && (
                  <div className="mt-1 flex flex-col gap-[3px] pe-[14px]">
                    {f.actions.map((a, i) => (
                      <div key={i} className="text-xs">
                        ◦ <strong className="text-foreground">{a.actionType}</strong>
                        {` (${(phaseLabels[a.phase] || PHASE_LABELS[a.phase] || `שלב ${a.phase}`).split(' — ')[1] || a.phase}${a.estimatedMins ? `, ${a.estimatedMins} דק'` : ''})`}
                        {a.description && ` — ${a.description}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>• תנאים מקדימים: <strong className="text-foreground">{f.prerequisites.length ? f.prerequisites.join(', ') : 'אין'}</strong>{f.prerequisitesNote && ` — ${f.prerequisitesNote}`}</div>

              <div>
                <div>• <strong className="text-foreground">{f.actions.filter(a => a.actionType === 'בדיקה ידנית').length} בדיקות מיוחדות</strong></div>
                {f.actions.filter(a => a.actionType === 'בדיקה ידנית').length > 0 && (
                  <div className="mt-1 flex flex-col gap-[3px] pe-[14px]">
                    {f.actions.filter(a => a.actionType === 'בדיקה ידנית').map((a, i) => (
                      <div key={i} className="text-xs">
                        ◦ {(phaseLabels[a.phase] || PHASE_LABELS[a.phase] || `שלב ${a.phase}`).split(' — ')[1] || a.phase}{a.description && ` — ${a.description}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div>• <strong className="text-foreground">{f.monitoringPoints.length} נקודות בקרה</strong> הוגדרו</div>
                {f.monitoringPoints.length > 0 && (
                  <div className="mt-1 flex flex-col gap-[3px] pe-[14px]">
                    {f.monitoringPoints.map((m, i) => (
                      <div key={i} className="text-xs">
                        ◦ <strong className="text-foreground">{m.type}</strong>{m.name && ` — ${m.name}`}{m.note && ` (${m.note})`}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>• Rollback: <strong className="text-foreground">{f.rollbackType || 'לא הוגדר'}</strong>{f.rollbackPlan && ` — ${f.rollbackPlan}`}</div>
            </div>
            {planValidationError[crNumber] && (
              <div className="mb-[10px] rounded-md border px-3 py-[10px] text-[12.5px] leading-[1.5] text-danger" style={{ background: C.dangerBg, borderColor: `${C.danger}40` }}>
                ⚠ {planValidationError[crNumber]}
              </div>
            )}
            <button onClick={() => confirmCrPlan(crNumber)} disabled={savingPlan === crNumber || lockedForEdit}
              className={cn('w-full rounded-md border-none p-[14px] text-sm font-bold text-white', (savingPlan === crNumber || lockedForEdit) ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{ background: (savingPlan === crNumber || lockedForEdit) ? C.textDisabled : GOLIVE }}>
              {savingPlan === crNumber ? 'שומר...' : lockedForEdit ? '✓ הוגש ונעול' : submitted ? '✓ שמור מחדש וסגור לעריכה' : '✓ אשר תוכנית CR'}
            </button>
            {derivedTaskNote[crNumber] && (
              <div className="mt-[10px] rounded-md border px-3 py-[10px] text-[12.5px] leading-[1.5] text-info" style={{ background: C.infoBg, borderColor: `${C.info}40` }}>
                {derivedTaskNote[crNumber]}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Left panel: single CR list item ─────────────────────────────────────────
  const renderListItem = (crNumber: string, crProposals: Proposal[]) => {
    const plan        = crPlans[crNumber];
    const label        = getCrLabel(crNumber);
    const isNotNeeded  = plan?.notNeededForPlan;
    const isSubmitted  = plan?.submissionStatus === 'SUBMITTED' || plan?.submissionStatus === 'APPROVED';
    const isReturned   = plan?.submissionStatus === 'RETURNED';
    // TARGET CR approval lives on TargetCrReview, not CrPlan.submissionStatus —
    // check that separately, or an approved TARGET CR shows "ממתין" forever.
    const isTargetCr   = /target/i.test(label || '') || /target/i.test(plan?.crType || '');
    // A submitted plan only counts as "done" once its own derived tasks are all
    // marked ready too — otherwise the CR looks finished while work under it
    // (assigned via "משימות נגזרות") is still in draft.
    const allTasksReady = crProposals.every(p => p.status === 'READY' || p.usedInTaskId);
    const isDone       = isNotNeeded || (isTargetCr ? !!targetCrStatus[crNumber] : (isSubmitted && allTasksReady));
    const isSelected   = selectedCr === crNumber;

    const chipStyle: React.CSSProperties = isReturned
      ? { background: C.dangerBg, color: C.danger }
      : isDone
      ? { background: C.successBg, color: C.success }
      : { background: C.warningBg, color: C.warning };
    const chipText = isReturned ? '⚠ הוחזר' : isDone ? '✅ הושלם' : '⏳ ממתין';

    return (
      <div key={crNumber}
        onClick={() => trySelectCr(crNumber)}
        className={cn('mx-2 mb-2 flex cursor-pointer flex-col gap-[6px] rounded-lg px-[14px] py-3 bg-card transition-shadow duration-fast', isSelected ? 'shadow-sm' : 'shadow-xs', isDone && !isSelected && 'opacity-65')}
        style={{ border: `1px solid ${isSelected ? GOLIVE : C.border}` }}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-sm px-[9px] py-0.5 font-mono text-[11px] font-bold" style={{ color: GOLIVE, background: `${GOLIVE}1F` }}>{crNumber}</span>
          <span className="flex-1" />
          <span className="shrink-0 rounded-full px-[10px] py-[3px] text-[10.5px] font-bold" style={chipStyle}>{chipText}</span>
        </div>
        <div className="text-[13px] font-bold leading-[1.55] text-foreground">
          {label || crNumber}
        </div>
      </div>
    );
  };

  // ── Right panel: full CR detail (plan + tasks) ───────────────────────────────
  const renderDetailPanel = (crNumber: string) => {
    const label        = getCrLabel(crNumber);
    const description  = getCrDescription(crNumber);
    const crProposals  = (grouped[crNumber] || []).slice().sort((a, b) => a.phase - b.phase);
    const isNotNeeded  = crPlans[crNumber]?.notNeededForPlan;
    const isSavingPln  = savingPlan === crNumber;
    const isTogglingNN = togglingNotNeeded.has(crNumber);
    const saved        = crPlans[crNumber];
    const f            = crPlanForms[crNumber] || emptyCrPlanForm();

    const draftCount = crProposals.filter(p => p.status === 'DRAFT' && !p.usedInTaskId).length;

    // Readiness = per-CR submission status (DRAFT → SUBMITTED/APPROVED via the
    // Section-1 gate + Section-7 confirm), independent of the legacy task-proposal flow.
    const crSubmitted = saved?.submissionStatus === 'SUBMITTED' || saved?.submissionStatus === 'APPROVED';
    const crReturned   = saved?.submissionStatus === 'RETURNED';
    const gateAnswered = !!f.gateAnswered;

    // TARGET CR — an umbrella CR wrapping a batch of QC defects for this team,
    // not a real development CR. Detected by crType/crLabel containing "TARGET"
    // (case-insensitive) — replaces the whole plan tab with a defect-approval gate.
    const isTargetCr = /target/i.test(label || '') || /target/i.test(saved?.crType || '');

    // Next CR navigation
    const activeCrs = crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([cr]) => cr);
    const curIdx    = activeCrs.indexOf(crNumber);
    const nextCrNum = curIdx >= 0 && curIdx < activeCrs.length - 1 ? activeCrs[curIdx + 1] : null;

    // Other teams sharing this CR — status-only (never plan content), so the lead
    // can tell at a glance whether they're waiting on someone else too. Shown here
    // (full detail panel) rather than on the compact list card, which doesn't have
    // room for both the full CR title and a wrapped grid of team badges.
    const otherTeams = (teamVisibility[crNumber]?.teams ?? []).filter(t => !t.isMine);

    const tabBtn = (tab: 'plan' | 'tasks', tabLabel: string, badge?: React.ReactNode) => (
      <button onClick={() => setSelectedTab(tab)}
        className="-mb-px flex cursor-pointer items-center gap-[5px] border-x-0 border-t-0 border-b-2 bg-transparent px-3 py-2 text-sm font-semibold"
        style={{
          color: selectedTab === tab ? C.brand : C.textMuted,
          borderBottomColor: selectedTab === tab ? C.brand : 'transparent',
        }}>
        {tabLabel}{badge}
      </button>
    );

    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-[#F5F5F5]">

        {/* Topbar */}
        <div className="flex shrink-0 items-center gap-[10px] border-b border-border bg-card px-[18px] py-[10px]">
          <span className="shrink-0 rounded-sm bg-info-bg px-[9px] py-[3px] font-mono text-sm font-bold text-info">{crNumber}</span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-foreground">{label || crNumber}</span>
          {!isNotNeeded && (
            crReturned ? (
              <span className="shrink-0 rounded-full border border-danger/35 bg-danger-bg px-[9px] py-0.5 text-[13px] font-bold text-danger">
                ⚠ הוחזר לתיקון
              </span>
            ) : crSubmitted ? (
              <span className="shrink-0 rounded-full border border-success/35 bg-success-bg px-[9px] py-0.5 text-[13px] font-bold text-success">
                ✅ הושלם
              </span>
            ) : gateAnswered ? (
              <span className="shrink-0 rounded-full border border-warning/35 bg-warning-bg px-[9px] py-0.5 text-[13px] font-bold text-warning">
                ⏳ בטיוטה
              </span>
            ) : (
              <span className="shrink-0 rounded-full border border-border bg-muted px-[9px] py-0.5 text-[13px] font-bold text-subtle-foreground">
                טרם נענה
              </span>
            )
          )}
          {/* Once the gate has been answered, offer a quick escape hatch back to
              "not needed" — before that, the gate itself is the only entry point. */}
          {!locked && isNotNeeded && (
            <button
              onClick={() => toggleNotNeeded(crNumber)}
              disabled={isTogglingNN}
              title="לחץ להחזיר CR זה לתהליך הרגיל"
              className={cn('shrink-0 rounded-md px-[9px] py-[3px] text-[13px] font-semibold', isTogglingNN ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{ color: C.warning, background: C.warningBg, border: `1px solid ${C.warning}50` }}>
              {isTogglingNN ? '...' : '↩ החזר לתהליך'}
            </button>
          )}
          {/* Symmetric escape hatch — for when "יש השפעה מיוחדת" (Yes) was picked
              on the initial gate by mistake and it's actually a regular CR. Only
              offered while the plan is still empty — switching to "not needed"
              deletes every derived task, so once real content exists (actions,
              monitoring points, or derived tasks) this must be removed manually
              first rather than wiped in one click. */}
          {!locked && !isNotNeeded && gateAnswered && f.actions.length === 0 && f.monitoringPoints.length === 0 && crProposals.length === 0 && (
            <button
              onClick={() => toggleNotNeeded(crNumber)}
              disabled={isTogglingNN}
              title="לחץ אם בטעות סימנת שקיימת השפעה תפעולית מיוחדת ל-CR זה"
              className={cn('shrink-0 rounded-md px-[9px] py-[3px] text-[13px] font-semibold', isTogglingNN ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{ color: C.textMuted, background: C.bgNested, border: `1px solid ${C.border}` }}>
              {isTogglingNN ? '...' : '↩ בעצם אין השפעה מיוחדת'}
            </button>
          )}
          {/* Deleting a whole CR plan is destructive and irreversible — restricted
              to managers (RELEASE_MANAGER/ADMIN), not the submitting team lead. */}
          {!locked && isManager && (
            <button onClick={() => deleteCrGroup(crNumber)}
              title="מחיקת תוכנית — הרשאת מנהל בלבד"
              className="shrink-0 cursor-pointer rounded-md px-[9px] py-[3px] text-[13px] text-danger" style={{ background: C.dangerBg, border: `1px solid ${C.danger}40` }}>
              🗑
            </button>
          )}
        </div>

        {description && (
          <div className="shrink-0 border-b border-border bg-card px-[18px] py-[10px] text-[13px] leading-[1.5] text-muted-foreground">
            {description}
          </div>
        )}

        {otherTeams.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-[18px] py-3">
            <span className="shrink-0 text-[13.5px] font-bold text-muted-foreground">צוותים מעורבים:</span>
            {otherTeams.map(t => {
              // No Special Activity is a distinct outcome from a real submission —
              // not a shade of "done". Kept visually separate (blue vs green) so a
              // lead can tell "team opted out" from "team did the work" at a glance.
              const isSubmitted   = t.submissionStatus === 'SUBMITTED' || t.submissionStatus === 'APPROVED';
              const isNoActivity  = t.notNeededForPlan && isSubmitted;
              const isReturned    = t.submissionStatus === 'RETURNED';
              const canPreview    = isSubmitted; // draft/not-started have nothing stable to show yet
              const dotColor = isReturned ? C.danger
                : isNoActivity ? C.info
                : isSubmitted  ? C.success
                : t.started    ? C.warning
                : C.textDisabled;
              const teamLabel = isReturned ? 'הוחזר' : isNoActivity ? 'אין פעילות מיוחדת' : isSubmitted ? 'הוגש' : t.started ? 'בטיוטה' : 'טרם התחיל';
              return (
                <span key={t.teamId} title={canPreview ? `${teamLabel} — לחץ לתצוגה מקדימה` : teamLabel}
                  onClick={canPreview ? () => openTeamPreview(crNumber, t.teamId, t.teamName) : undefined}
                  className={cn('inline-flex items-center gap-[6px] rounded-full border border-border bg-muted px-3 py-[5px] text-[12.5px] font-bold text-muted-foreground', canPreview ? 'cursor-pointer' : 'cursor-default')}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
                  {t.teamName}
                </span>
              );
            })}
          </div>
        )}

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-border bg-card px-[18px]">
          {tabBtn('plan', 'תוכנית CR')}
          {tabBtn('tasks', 'משימות נגזרות',
            draftCount > 0
              ? <span className="rounded-full border border-warning/40 text-[11px] font-bold px-[5px] py-px" style={{ background: `${C.warning}20`, color: C.warning }}>{draftCount} טיוטא</span>
              : crProposals.length > 0
              ? <span className="rounded-full border border-success/30 text-[11px] font-bold px-[5px] py-px" style={{ background: `${C.success}15`, color: C.success }}>{crProposals.length}</span>
              : undefined
          )}
        </div>

        {/* Tab content */}
        {selectedTab === 'plan' ? (
          <div className="flex-1 overflow-y-auto px-[18px] py-[14px]">
            {isTargetCr ? (
              renderTargetCrGate(crNumber, label, teamIdOverride || myTeamId)
            ) : isNotNeeded ? (
              <div className="flex flex-col items-center justify-center gap-3 px-0 py-12 text-center">
                <div className="max-w-[440px] rounded-md px-[18px] py-[14px] text-[13px] leading-[1.6]" style={{ background: C.successBg, border: '1px solid rgba(22,163,74,.25)', color: '#0F5A2A' }}>
                  ✓ נבחר: ללא השפעה מיוחדת — CR זה נכלל בהטמעה הרגילה ואינו דורש תיאום נוסף, סקריפטים או בדיקות מיוחדות.
                </div>
                {!locked && (
                  <button onClick={() => toggleNotNeeded(crNumber)} disabled={isTogglingNN}
                    className={cn('rounded-md border border-border px-[18px] py-2 text-sm font-semibold text-subtle-foreground', isTogglingNN ? 'cursor-not-allowed' : 'cursor-pointer')}>
                    {isTogglingNN ? '...' : '↩ בעצם יש השפעה — פתח מחדש'}
                  </button>
                )}
              </div>
            ) : !gateAnswered ? (
              renderGate(crNumber)
            ) : (
              renderCrPlanForm(crNumber)
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-[18px] py-[14px]">
            {crProposals.length === 0 && (
              <div className="px-0 py-10 text-center text-[15px] text-subtle-foreground">
                <div className="mb-2 text-[32px]">📋</div>
                <div>אין משימות — הפק מהתוכנית או הוסף ידנית</div>
              </div>
            )}
            {crProposals.map(renderRow)}
            {!locked && !isNotNeeded && openFormForCr !== crNumber && (
              <button onClick={() => openAdd(crNumber, label)}
                className="mt-[10px] w-full cursor-pointer rounded-lg border-none p-[9px] text-[15px] font-semibold text-white" style={{ background: C.statusOpen }}>
                + הוסף משימה לביצוע
              </button>
            )}
          </div>
        )}

        {/* Footer — save draft + next navigation */}
        {selectedTab === 'plan' && !isNotNeeded && gateAnswered && (!crSubmitted || unlockedForEdit.has(crNumber)) && (
          <div className="flex shrink-0 items-center gap-[9px] border-t border-border bg-card px-[18px] py-[10px]">
            <button onClick={() => saveCrPlan(crNumber)} disabled={isSavingPln}
              className={cn('rounded-md border border-border px-[18px] py-[7px] text-sm font-semibold text-muted-foreground', isSavingPln ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{ background: isSavingPln ? C.textDisabled : C.bgNested }}>
              {isSavingPln ? 'שומר...' : 'שמור טיוטה'}
            </button>
            {nextCrNum && (
              <button onClick={() => trySelectCr(nextCrNum)}
                className="cursor-pointer rounded-md bg-card px-[14px] py-[7px] text-sm font-semibold" style={{ color: GOLIVE, border: `1px solid ${GOLIVE}40` }}>
                הבא: {nextCrNum} ←
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="text-foreground">
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Cross-team plan preview — read-only, only ever shown for a SUBMITTED/APPROVED plan */}
      {teamPreview && (
        <div dir="rtl" onClick={() => setTeamPreview(null)} className="fixed inset-0 z-[4000] flex items-center justify-center" style={{ background: C.bgOverlay }}>
          <div onClick={e => e.stopPropagation()} className="max-h-[85vh] w-[95vw] max-w-[560px] overflow-y-auto rounded-3xl bg-card px-7 py-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[17px] font-bold text-foreground">
                תוכנית {teamPreview.teamName}
              </div>
              <button onClick={() => setTeamPreview(null)} className="cursor-pointer border-none bg-transparent px-1.5 py-0.5 text-lg text-subtle-foreground">✕</button>
            </div>

            {teamPreview.loading && (
              <div className="p-[30px] text-center text-sm text-subtle-foreground">טוען...</div>
            )}
            {teamPreview.error && (
              <div className="mt-3 rounded-md bg-danger-bg p-[14px] text-sm text-danger">
                {teamPreview.error}
              </div>
            )}
            {teamPreview.data && (
              teamPreview.data.notNeededForPlan && teamPreview.data.actions.length === 0 ? (
                <div className="mt-3 rounded-md bg-info-bg p-5 text-center text-sm text-info">
                  🔵 הצוות מעורב ב-CR זה אך אין לו פעילות מיוחדת
                </div>
              ) : (
                <div className="mt-[14px] flex flex-col gap-4">
                  {teamPreview.data.submittedByName && (
                    <div className="text-[13px] text-subtle-foreground">
                      הוגש ע"י {teamPreview.data.submittedByName}
                      {teamPreview.data.submittedAt && ` · ${formatDateTime(teamPreview.data.submittedAt)}`}
                    </div>
                  )}

                  {teamPreview.data.actions.length > 0 && (
                    <div>
                      <div className="mb-[6px] text-[13px] font-bold text-muted-foreground">
                        פעילויות ({teamPreview.data.actions.length})
                      </div>
                      <div className="flex flex-col gap-[6px]">
                        {teamPreview.data.actions.map((a, i) => (
                          <div key={i} className="rounded-md bg-muted px-[10px] py-2 text-[13px]">
                            <div className="mb-0.5 flex items-center gap-[6px]">
                              <span className="font-bold text-primary">{a.actionType}</span>
                              {a.system && <span className="text-subtle-foreground">· {a.system}</span>}
                              {a.estimatedMins != null && <span className="text-subtle-foreground">· {a.estimatedMins} דק'</span>}
                              {a.ownerName && <span className="ms-auto text-subtle-foreground">{a.ownerName}</span>}
                            </div>
                            <div className="text-foreground">{a.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {teamPreview.data.monitoringPoints.length > 0 && (
                    <div>
                      <div className="mb-[6px] text-[13px] font-bold text-muted-foreground">
                        נקודות בקרה ({teamPreview.data.monitoringPoints.length})
                      </div>
                      <div className="flex flex-col gap-[6px]">
                        {teamPreview.data.monitoringPoints.map((m, i) => (
                          <div key={i} className="rounded-md bg-muted px-[10px] py-2 text-[13px]">
                            <span className="font-bold text-info">{m.type}</span>{' — '}{m.name}
                            {m.note && <div className="mt-0.5 text-subtle-foreground">{m.note}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(teamPreview.data.nightTestNeeded || teamPreview.data.nextDayTestNeeded) && (
                    <div className="text-[13px] text-muted-foreground">
                      <strong>בדיקות: </strong>
                      {[teamPreview.data.nightTestNeeded && 'ליל גרסה', teamPreview.data.nextDayTestNeeded && 'יום אחרי'].filter(Boolean).join(' + ')}
                    </div>
                  )}

                  <div className="text-[13px] text-muted-foreground">
                    <strong>Rollback: </strong>{teamPreview.data.rollbackType || 'לא הוגדר'}
                    {teamPreview.data.rollbackPlan && <div className="mt-0.5 text-subtle-foreground">{teamPreview.data.rollbackPlan}</div>}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Task Wizard — guided add for a single action or monitoring point */}
      {taskWizard && (
        <TaskWizardModal
          crNumber={taskWizard.crNumber}
          teamName={teamNameOverride || myTeamName}
          initialType={taskWizard.type}
          initialPhase={taskWizard.phase}
          phaseOptions={phaseOptions}
          phaseLabels={phaseLabels}
          subPhaseOpts={subPhaseOpts}
          teamAppList={teamAppList}
          teamUsers={teamUsers}
          onCancel={() => setTaskWizard(null)}
          onConfirm={result => {
            const cr = taskWizard.crNumber;
            setCrPlanForms(prev => {
              const current = prev[cr] || emptyCrPlanForm();
              return {
                ...prev,
                [cr]: result.kind === 'action'
                  ? { ...current, actions: [...current.actions, result.action] }
                  : { ...current, monitoringPoints: [...current.monitoringPoints, result.point] },
              };
            });
            setTaskWizard(null);
          }}
        />
      )}

      {/* Extract-tasks modal */}
      {extractModal && (
        <div dir="rtl" className="fixed inset-0 z-[4000] flex items-center justify-center" style={{ background: C.bgOverlay }}>
          <div className="max-h-[85vh] w-[95vw] max-w-[560px] overflow-y-auto rounded-3xl bg-card px-7 py-6 shadow-xl">
            <div className="mb-1 text-[17px] font-bold text-foreground">
              ⚡ הפק משימות מ{extractModal.sourceLabel}
            </div>
            <div className="mb-4 text-sm text-subtle-foreground">
              CR {extractModal.crNumber} — בחר אילו שורות להפוך למשימות לביצוע
            </div>

            <div className="mb-5 flex flex-col gap-2">
              {extractModal.items.map((item, i) => (
                <div key={i} className="flex items-start gap-[10px] rounded-lg px-3 py-[10px]" style={{
                  background: item.checked ? C.infoBg : C.bgNested,
                  border: `1px solid ${item.checked ? `${C.info}40` : C.border}`,
                }}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, checked: e.target.checked } : it),
                    } : null)}
                    className="mt-[3px] shrink-0 cursor-pointer"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <input
                      value={item.text}
                      onChange={e => setExtractModal(m => m ? {
                        ...m,
                        items: m.items.map((it, j) => j === i ? { ...it, text: e.target.value } : it),
                      } : null)}
                      className="w-full box-border border-none bg-transparent text-[15px] text-foreground outline-none"
                      disabled={!item.checked}
                    />
                    {item.duplicateId && (
                      <span className="text-xs font-semibold text-warning">⚠ כבר קיימת — תישאל אם להחליף</span>
                    )}
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={item.estimatedMins}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, estimatedMins: e.target.value } : it),
                    } : null)}
                    disabled={!item.checked}
                    placeholder="דק'"
                    className="w-[54px] shrink-0 rounded-sm border border-border px-1 py-0.5 text-center text-[13px]"
                  />
                  <select
                    value={item.phase}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, phase: parseInt(e.target.value) } : it),
                    } : null)}
                    disabled={!item.checked}
                    className="shrink-0 rounded-sm border border-border bg-card px-1 py-0.5 text-[13px] text-muted-foreground"
                  >
                    {(Object.keys(phaseLabels).length > 0
                      ? Object.keys(phaseLabels).map(Number).sort((a, b) => a - b)
                      : [1, 2, 3, 4]
                    ).map(ph => (
                      <option key={ph} value={ph}>{(phaseLabels[ph] || PHASE_LABELS[ph])?.split(' — ')[1] || `שלב ${ph}`}</option>
                    ))}
                  </select>
                  <select
                    value={item.assignedUserName}
                    onChange={e => setExtractModal(m => m ? {
                      ...m,
                      items: m.items.map((it, j) => j === i ? { ...it, assignedUserName: e.target.value } : it),
                    } : null)}
                    disabled={!item.checked}
                    className="max-w-[110px] shrink-0 rounded-sm border bg-card px-1 py-0.5 text-[13px] text-muted-foreground"
                    style={{ borderColor: item.checked && !item.assignedUserName ? C.danger : C.border }}
                  >
                    <option value="">-- אחראי --</option>
                    {myTeamMembers.map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {extractModal.items.some(it => it.checked && !it.assignedUserName) && (
              <div className="-mt-2 mb-3 text-sm text-danger">
                ⚠ יש לבחור אחראי לכל משימה מסומנת — משימה בלי אחראי לא תעבור לתוכנית בפועל
              </div>
            )}

            {/* Select all / none */}
            <div className="mb-4 flex gap-2">
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: true })) } : null)}
                className="cursor-pointer rounded-md border border-border bg-card px-[10px] py-1 text-sm text-muted-foreground">
                בחר הכל
              </button>
              <button onClick={() => setExtractModal(m => m ? { ...m, items: m.items.map(it => ({ ...it, checked: false })) } : null)}
                className="cursor-pointer rounded-md border border-border bg-card px-[10px] py-1 text-sm text-muted-foreground">
                בטל הכל
              </button>
            </div>

            <div className="flex justify-end gap-[10px]">
              <button onClick={() => setExtractModal(null)}
                className="cursor-pointer rounded-lg border border-border bg-card px-[18px] py-2 text-[15px] text-muted-foreground">
                ביטול
              </button>
              {(() => {
                const checkedCount = extractModal.items.filter(i => i.checked).length;
                const blocked = checkedCount === 0 || extractModal.items.some(i => i.checked && !i.assignedUserName);
                return (
                  <button
                    onClick={createExtracted}
                    disabled={extracting || blocked}
                    className={cn('rounded-lg border-none px-[22px] py-2 text-[15px] font-bold', blocked ? 'cursor-default' : 'cursor-pointer')}
                    style={{
                      background: blocked ? C.bgNested : C.brand,
                      color: blocked ? C.textDisabled : C.textInverse,
                    }}
                  >
                    {extracting ? 'יוצר...' : `צור ${checkedCount} משימות`}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-xs">
        <div>
          <div className="mb-0.5 flex items-center gap-[10px]">
            <span className="text-[19px] font-bold text-foreground">התכנון שלי — My CR Planning</span>
            {myTeamName && (
              <span className="rounded-full px-[11px] py-[3px] text-[11px] font-bold" style={{ background: `${GOLIVE}22`, color: GOLIVE }}>
                {myTeamName}
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-subtle-foreground">
            {versionName}
            {reviewMeetingTime && (
              <> · יש להגיש את כל התוכניות לפני פגישת הסקירה · {formatDateTime(reviewMeetingTime)} 🗓</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          {proposals.length > 0 && (
            <span className="text-[13px] text-subtle-foreground">
              {totalReady}/{proposals.length} מוכן
            </span>
          )}
          {!locked && (
            <button
              onClick={() => syncCrItems(false)}
              disabled={syncLoading}
              className={cn('whitespace-nowrap rounded-md px-4 py-[7px] text-[13.5px] font-bold', syncLoading ? 'cursor-not-allowed' : 'cursor-pointer')}
              style={{
                background: syncLoading ? C.bgNested : C.successBg,
                color: syncLoading ? C.textMuted : C.success, border: `1px solid ${syncLoading ? C.border : 'rgba(22,163,74,.25)'}`,
              }}
            >
              {syncLoading ? '⏳ מסנכרן...' : '🔄 סנכרן רשימת פיתוחים'}
            </button>
          )}
          {!locked && (
            <button onClick={() => openAdd()} className="cursor-pointer rounded-md px-4 py-[7px] text-[13.5px] font-semibold"
              style={{ background: C.brandDim, color: C.brand, border: `1px solid ${C.brand}40` }}>
              + הוסף משימה
            </button>
          )}
          {locked ? (
            <>
              <span className="rounded-md px-4 py-[7px] text-[13.5px] font-bold" style={{ background: C.successBg, color: C.success, border: '1px solid rgba(22,163,74,.25)' }}>
                הוגש ✓
              </span>
              {isManager && (
                <button
                  onClick={() => setManagerUnlocked(true)}
                  className="cursor-pointer whitespace-nowrap rounded-md px-[14px] py-[7px] text-[13px] font-bold"
                  style={{ background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80` }}
                >
                  ✏️ עדכן כמנהל
                </button>
              )}
            </>
          ) : managerUnlocked ? (
            <>
              <span className="whitespace-nowrap rounded-md px-[14px] py-[7px] text-[13px] font-bold" style={{ background: C.warningBg, color: C.warning, border: `1px solid ${C.warning}80` }}>
                ✏️ עריכת מנהל
              </span>
              <button
                onClick={() => setManagerUnlocked(false)}
                className="cursor-pointer whitespace-nowrap rounded-md border border-border px-[14px] py-[7px] text-[13px] font-bold"
                style={{ background: C.bgNested, color: C.textSecondary }}
              >
                ✓ סיים עריכה
              </button>
            </>
          ) : (
            <div className="flex flex-col items-end gap-[3px]">
              <button
                onClick={submitDone}
                disabled={submitting || !canSubmit}
                title={!canSubmit ? `יש להשלים ${crGroups.length - doneCrCount} CR-ים לפני ההגשה` : ''}
                className={cn('rounded-md border-none px-[18px] py-2 text-sm font-bold', (submitting || !canSubmit) ? 'cursor-not-allowed' : 'cursor-pointer')}
                style={{
                  background: submitting ? C.textDisabled : (!canSubmit ? C.bgNested : GOLIVE),
                  color: (!canSubmit && !submitting) ? C.textDisabled : C.textInverse,
                  boxShadow: canSubmit && !submitting ? SHADOW.sm : 'none',
                }}
              >
                {submitting ? '...' : 'סיימתי הגשת תוכניות'}
              </button>
              {!canSubmit && crGroups.length > 0 && (
                <span className="whitespace-nowrap text-[11px] text-subtle-foreground">
                  נותרו {crGroups.length - doneCrCount} CR-ים למילוי
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sync error */}
      {syncError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border px-4 py-[10px] text-[15px] text-danger" style={{ background: C.dangerBg, borderColor: C.danger }}>
          ⚠️ {syncError}
          <button onClick={() => setSyncError(null)} className="ms-auto cursor-pointer border-none bg-transparent font-bold text-danger">×</button>
        </div>
      )}

      {/* Submission error */}
      {submitError && (
        <div className="mb-3 rounded-lg border px-4 py-[10px] text-[15px] text-danger" style={{ background: C.dangerBg, borderColor: C.danger }}>
          <div className="flex items-center gap-2">
            ⚠️ {submitError}
            <button onClick={() => { setSubmitError(null); setSubmitErrorCrs([]); }} className="ms-auto cursor-pointer border-none bg-transparent font-bold text-danger">×</button>
          </div>
          {submitErrorCrs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-[6px]">
              {submitErrorCrs.map(cr => (
                <span key={cr}
                  onClick={() => trySelectCr(cr)}
                  className="cursor-pointer rounded-full border px-[10px] py-[3px] font-mono text-[13px] font-bold"
                  style={{
                    background: selectedCr === cr ? C.danger : C.bgCard,
                    color: selectedCr === cr ? C.textInverse : C.danger,
                    borderColor: C.danger,
                  }}>
                  {cr} ←
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submitted banner */}
      {locked && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border-2 px-5 py-[14px]" style={{ background: C.successBg, borderColor: C.success }}>
          <span className="text-2xl">✅</span>
          <div>
            <div className="text-base font-bold text-success">ההגשה הושלמה</div>
            <div className="mt-0.5 text-[15px] text-success opacity-85">מנהל הלילה יוכל לקדם את התוכנית לשלב הבא לאחר שכל הצוותים יגישו</div>
          </div>
        </div>
      )}
      {/* Manager edit banner */}
      {managerUnlocked && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border-2 px-5 py-3" style={{ background: C.warningBg, borderColor: C.warning }}>
          <span className="text-[22px]">✏️</span>
          <div>
            <div className="text-[15px] font-bold text-warning">עריכת מנהל פעילה</div>
            <div className="mt-0.5 text-sm text-warning">ניתן לערוך, להוסיף ולמחוק משימות. לחץ "סיים עריכה" בסיום.</div>
          </div>
        </div>
      )}

      {/* Proposal form modal (position:fixed — safe to render at top level) */}
      {openFormForCr !== null && (!locked || editId) && renderForm()}

      {/* Main split panel */}
      {loading ? (
        <div className="p-10 text-center text-subtle-foreground">טוען...</div>
      ) : crGroups.length === 0 && freeGroup.length === 0 ? (
        <div className="rounded-2xl bg-card px-10 py-[60px] text-center text-subtle-foreground shadow-sm">
          <div className="mb-3 text-5xl">📋</div>
          <div className="mb-[6px] text-[17px] text-muted-foreground">אין CR-ים עדיין</div>
          <div className="text-[15px]">לחץ "🔄 סנכרן רשימת פיתוחים" לטעינה אוטומטית</div>
        </div>
      ) : (
        <div className="flex min-h-[68vh] overflow-hidden rounded-xl border border-border bg-muted">

          {/* LEFT: CR list */}
          <div className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-e border-border bg-muted">

            {/* List header with progress */}
            <div className="shrink-0 border-b border-border bg-card px-4 pb-3 pt-[14px]">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12.5px] font-semibold text-muted-foreground">
                  {doneCrCount} מתוך {crGroups.length} תוכניות הושלמו
                </span>
                <span className="text-xl font-extrabold" style={{ color: GOLIVE }}>
                  {crGroups.length > 0 ? Math.round(doneCrCount / crGroups.length * 100) : 0}%
                </span>
              </div>
              <div className="h-[10px] overflow-hidden rounded-[5px] bg-muted">
                <div className="h-full rounded-[5px] transition-[width] duration-300 ease-out" style={{ width: `${crGroups.length > 0 ? Math.round(doneCrCount / crGroups.length * 100) : 0}%`, background: GOLIVE }} />
              </div>
            </div>

            {/* Active CRs */}
            <div className="pt-2">
              {crGroups.filter(([cr]) => !crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}
            </div>

            {/* Free / infrastructure tasks — always visible so users can always add a task without CR */}
            <div onClick={() => trySelectCr(FREE_KEY, selectedTab)}
              className={cn('flex cursor-pointer items-start gap-[9px] border-b px-[14px] py-[9px] border-s-[3px]', selectedCr === FREE_KEY ? 'border-s-primary' : 'border-s-transparent')}
              style={{ borderBottomColor: C.bgNested, background: selectedCr === FREE_KEY ? C.infoBg : 'transparent' }}>
              <div className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: freeGroup.length === 0 ? C.borderEm : freeGroup.every(p => p.status === 'READY' || p.usedInTaskId) ? C.success : C.warning, border: freeGroup.length === 0 ? `1.5px solid ${C.textDisabled}` : 'none' }} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-bold" style={{ color: freeGroup.length === 0 ? C.textDisabled : C.textMuted }}>ללא CR</div>
                <div className="mt-px text-[13px] leading-[1.35] text-muted-foreground">משימות תשתיתיות</div>
                <div className="mt-0.5 text-xs text-subtle-foreground">
                  {freeGroup.length === 0 ? 'לחץ להוספת משימה' : `${freeGroup.filter(p => p.status === 'READY' || p.usedInTaskId).length}/${freeGroup.length} מוכן`}
                </div>
              </div>
            </div>

            {/* Not-needed section */}
            {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length > 0 && (
              <>
                <div className="mt-1 border-t px-[14px] pb-1 pt-[7px]" style={{ borderTopColor: C.bgNested }}>
                  <div className="text-xs font-bold uppercase tracking-[.06em] text-subtle-foreground">
                    לא נדרשים לתוכנית ({crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).length})
                  </div>
                  <div className="mt-0.5 text-xs text-subtle-foreground">לחץ על CR לביטול הסימון ↩</div>
                </div>
                {crGroups.filter(([cr]) => crPlans[cr]?.notNeededForPlan).map(([crNumber, crProposals]) => renderListItem(crNumber, crProposals))}
              </>
            )}
          </div>

          {/* RIGHT: detail panel */}
          {selectedCr === FREE_KEY ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-[#F5F5F5]">
              <div className="flex shrink-0 items-center gap-[10px] border-b border-border bg-card px-[18px] py-[10px]">
                <span className="rounded-sm bg-muted px-[9px] py-[3px] font-mono text-sm font-bold text-subtle-foreground">ללא CR</span>
                <span className="flex-1 text-[15px] font-semibold text-foreground">משימות תשתיתיות / כלליות</span>
              </div>
              <div className="flex-1 overflow-y-auto px-[18px] py-[14px]">
                {freeGroup.sort((a, b) => a.phase - b.phase).map(renderRow)}
                {!submissionDone && openFormForCr !== FREE_KEY && (
                  <button onClick={() => openAdd(undefined, undefined, true)}
                    className="mt-[10px] w-full cursor-pointer rounded-lg border-none p-[9px] text-[15px] font-semibold text-white" style={{ background: C.textMuted }}>
                    + הוסף משימה
                  </button>
                )}
              </div>
            </div>
          ) : selectedCr ? renderDetailPanel(selectedCr) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[15px] text-subtle-foreground">
              <div className="text-[40px]">←</div>
              <div>בחר CR מהרשימה משמאל</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
