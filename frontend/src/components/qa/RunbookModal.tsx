import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { formatDate } from '../../utils/dateFormat';

const API  = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const BLUE = '#4573D2';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunbookStep {
  num:         number;
  activity:    string;
  defaultTeam: string;
  duration:    string;
  startTime:   string;
  endTime:     string;
  bold?:       boolean;
}

export interface RunbookDef { title: string; envLabel: string; steps: RunbookStep[] }

// Local, in-memory shape once a plan's steps are loaded for editing. `key` is
// a stable per-step id independent of array position — assigned as the
// original array index for built-in plans (matching RunbookEntry.stepIndex
// values already saved under the old position-based scheme), or server-issued
// for steps added after a template override exists — so add/delete/reorder
// never silently reassigns an existing step's saved assignment data to a
// different activity.
interface EditableStep extends RunbookStep { key: number }

function toEditable(steps: RunbookStep[]): EditableStep[] {
  return steps.map((s, i) => ({ ...s, key: i }));
}

type RowData = {
  employee:       string;
  employeeUserId: string | null;
  startTime:      string;
  endTime:        string;
  team:           string;
  status:         string;
};

type TeamMember = { id: string; fullName: string; email: string };
type TeamOption = { id: string; name: string; members: TeamMember[] };

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'טרם החל',    bg: C.bgNested,              color: C.textMuted },
  { value: 'in_progress', label: 'בתהליך',     bg: 'rgba(69,115,210,0.15)', color: BLUE },
  { value: 'done',        label: 'הושלם',      bg: 'rgba(40,167,69,0.15)',  color: '#28a745' },
  { value: 'issue',       label: 'נתקל בבעיה', bg: 'rgba(220,53,69,0.15)', color: '#dc3545' },
];

function statusCfg(v: string) {
  return STATUS_OPTIONS.find(s => s.value === v) ?? STATUS_OPTIONS[0];
}

// ── Step definitions ──────────────────────────────────────────────────────────

export const RUNBOOKS: Record<string, RunbookDef> = {
  REFRESH_INT_FULL: {
    title: "מסלול א' — רענון מלא", envLabel: 'appint + HNINT',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',              defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'לקיחת SNAP',                             defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'רענון סטאפ בילי',                         defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:4,  activity:'ביצוע POST WIZ',                          defaultTeam:'WIZ',   duration:'3:00',   startTime:'07:00', endTime:'10:00' },
      { num:5,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',      defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:6,  activity:'Wiz_load',                                defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:7,  activity:'Wiz_load_tnm',                            defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:8,  activity:'העלאת מערכת',                             defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:9,  activity:'לוודא שEAI מעודכן לגרסת ייצור',          defaultTeam:'EAI',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:10, activity:'בדיקות קבלת סביבה',                       defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:11, activity:'שחרור מערכת',                             defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
      { num:12, activity:'העברת גרסה',                              defaultTeam:'פיתוח', duration:'1:00',   startTime:'11:55', endTime:'12:55', bold:true },
    ],
  },
  REFRESH_INT_BILLY: {
    title: "מסלול ב' — רק סטאפ", envLabel: 'appint + HNINT',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',              defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'רענון סטאפ בילי',                         defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'ביצוע POST WIZ',                          defaultTeam:'WIZ',   duration:'2:00',   startTime:'08:00', endTime:'10:00' },
      { num:4,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',      defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:5,  activity:'Wiz_load',                                defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:6,  activity:'Wiz_load_tnm',                            defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:7,  activity:'העלאת מערכת',                             defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:8,  activity:'בדיקות קבלת סביבה',                       defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:9,  activity:'שחרור מערכת',                             defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
    ],
  },
  REFRESH_QA_PREP: {
    title: "מסלול א' — רענון מלא", envLabel: 'appqa2 + hntest',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',              defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'לקיחת SNAP',                             defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'רענון סטאפ בילי',                         defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:4,  activity:'ביצוע POST WIZ',                          defaultTeam:'WIZ',   duration:'3:00',   startTime:'07:00', endTime:'10:00' },
      { num:5,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',      defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:6,  activity:'Wiz_load',                                defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:7,  activity:'Wiz_load_tnm',                            defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:8,  activity:'העלאת מערכת',                             defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:9,  activity:'לוודא שEAI מעודכן לגרסת ייצור',          defaultTeam:'EAI',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:10, activity:'בדיקות קבלת סביבה',                       defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:11, activity:'שחרור מערכת',                             defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
      { num:12, activity:'העברת גרסת WIZ חדשה לסביבה',             defaultTeam:'פיתוח', duration:'1:00',   startTime:'11:55', endTime:'12:55', bold:true },
      { num:13, activity:'העברת גרסת EAI חדשה לסביבה',             defaultTeam:'EAI',   duration:'1:00',   startTime:'12:55', endTime:'13:55', bold:true },
      { num:14, activity:'העברת גרסת CRM חדשה לסביבה',             defaultTeam:'CRM',   duration:'1:00',   startTime:'13:55', endTime:'14:55', bold:true },
    ],
  },
  REFRESH_QA_BILLY: {
    title: "מסלול ב' — רק סטאפ", envLabel: 'appqa2 + hntest',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',              defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'רענון סטאפ בילי',                         defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'ביצוע POST WIZ',                          defaultTeam:'WIZ',   duration:'2:00',   startTime:'08:00', endTime:'10:00' },
      { num:4,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',      defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:5,  activity:'Wiz_load',                                defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:6,  activity:'Wiz_load_tnm',                            defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:7,  activity:'העלאת מערכת',                             defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:8,  activity:'בדיקות קבלת סביבה',                       defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:9,  activity:'שחרור מערכת',                             defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
      { num:10, activity:'העברת גרסת WIZ חדשה לסביבה',             defaultTeam:'פיתוח', duration:'1:00',   startTime:'11:55', endTime:'12:55', bold:true },
      { num:11, activity:'העברת גרסת EAI חדשה לסביבה',             defaultTeam:'EAI',   duration:'1:00',   startTime:'12:55', endTime:'13:55', bold:true },
      { num:12, activity:'העברת גרסת CRM חדשה לסביבה',             defaultTeam:'CRM',   duration:'1:00',   startTime:'13:55', endTime:'14:55', bold:true },
    ],
  },
  REFRESH_DRY_RUN: {
    title: "מסלול א' — רענון מלא", envLabel: 'appint + HNINT',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',              defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'לקיחת SNAP',                             defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'רענון סטאפ בילי',                         defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:4,  activity:'ביצוע POST WIZ',                          defaultTeam:'WIZ',   duration:'3:00',   startTime:'07:00', endTime:'10:00' },
      { num:5,  activity:'העתקת WIZ מהיצור — החזרה לגרסת ייצור',   defaultTeam:'WIZ',   duration:'1:00',   startTime:'10:00', endTime:'10:30' },
      { num:6,  activity:'הפצה ל-CITRIX — החזרה לגרסת ייצור',      defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:30', endTime:'10:45' },
      { num:7,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',      defaultTeam:'QA',    duration:"10 דק'", startTime:'10:45', endTime:'10:55' },
      { num:8,  activity:'העלאת מערכת WIZ',                         defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:9,  activity:'Wiz_load_tnm',                            defaultTeam:'WIZ',   duration:"15 דק'", startTime:'11:10', endTime:'11:25' },
      { num:10, activity:'Wiz_load',                                defaultTeam:'WIZ',   duration:"15 דק'", startTime:'11:25', endTime:'11:40' },
      { num:11, activity:'לוודא שEAI מעודכן לגרסת ייצור',          defaultTeam:'EAI',   duration:"15 דק'", startTime:'11:10', endTime:'11:25' },
      { num:12, activity:'בדיקות קבלת סביבה',                       defaultTeam:'QA',    duration:"30 דק'", startTime:'11:40', endTime:'12:10' },
      { num:13, activity:'שחרור מערכת',                             defaultTeam:'מנהל',  duration:"15 דק'", startTime:'12:10', endTime:'12:25' },
      { num:14, activity:'הפעלת תוכנית חזרה גנרלית',               defaultTeam:'כולם',  duration:'—',       startTime:'12:25', endTime:'—',    bold:true },
    ],
  },
  REFRESH_PLIKE: {
    title: "מסלול א' — רענון מלא", envLabel: 'PLIKE',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',                       defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'לקיחת SNAP',                                      defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'רענון סטאפ בילי',                                  defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:4,  activity:'ביצוע POST WIZ',                                   defaultTeam:'WIZ',   duration:'3:00',   startTime:'07:00', endTime:'10:00' },
      { num:5,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',               defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:6,  activity:'Wiz_load',                                         defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:7,  activity:'Wiz_load_tnm',                                     defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:8,  activity:'העלאת מערכת',                                      defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:9,  activity:'בדיקות קבלת סביבה',                                defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:10, activity:'שחרור מערכת',                                      defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
      { num:11, activity:'העברת גרסת WIZ חדשה לסביבה מסביבת יצור',         defaultTeam:'פיתוח', duration:'1:00',   startTime:'11:55', endTime:'12:55', bold:true },
      { num:12, activity:'העברת גרסת EAI חדשה לסביבה מסביבת יצור',         defaultTeam:'EAI',   duration:'1:00',   startTime:'12:55', endTime:'13:55', bold:true },
    ],
  },
  REFRESH_TRAIN: {
    title: "מסלול א' — רענון מלא", envLabel: 'TRAIN',
    steps: [
      { num:1,  activity:'הורדת מערכת WIZ כולל DMQ',                       defaultTeam:'NETC',  duration:"10 דק'", startTime:'07:00', endTime:'07:10' },
      { num:2,  activity:'לקיחת SNAP',                                      defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:3,  activity:'רענון סטאפ בילי',                                  defaultTeam:'DBA',   duration:'1:00',   startTime:'07:00', endTime:'08:00' },
      { num:4,  activity:'ביצוע POST WIZ',                                   defaultTeam:'WIZ',   duration:'3:00',   startTime:'07:00', endTime:'10:00' },
      { num:5,  activity:'הפניית NC ו-HOTWIZ לסביבת הבדיקות',               defaultTeam:'QA',    duration:"10 דק'", startTime:'10:00', endTime:'10:10' },
      { num:6,  activity:'Wiz_load',                                         defaultTeam:'WIZ',   duration:"15 דק'", startTime:'10:10', endTime:'10:25' },
      { num:7,  activity:'Wiz_load_tnm',                                     defaultTeam:'WIZ',   duration:"30 דק'", startTime:'10:25', endTime:'10:55' },
      { num:8,  activity:'העלאת מערכת',                                      defaultTeam:'NETC',  duration:"15 דק'", startTime:'10:55', endTime:'11:10', bold:true },
      { num:9,  activity:'בדיקות קבלת סביבה',                                defaultTeam:'QA',    duration:"30 דק'", startTime:'11:10', endTime:'11:40' },
      { num:10, activity:'שחרור מערכת',                                      defaultTeam:'מנהל',  duration:"15 דק'", startTime:'11:40', endTime:'11:55' },
      { num:11, activity:'העברת גרסת WIZ חדשה לסביבה מסביבת יצור',         defaultTeam:'פיתוח', duration:'1:00',   startTime:'11:55', endTime:'12:55', bold:true },
      { num:12, activity:'העברת גרסת EAI חדשה לסביבה מסביבת יצור',         defaultTeam:'EAI',   duration:'1:00',   startTime:'12:55', endTime:'13:55', bold:true },
    ],
  },
};

// ── Public helpers ─────────────────────────────────────────────────────────────

export type RunbookTrigger = 'int' | 'qa' | 'REFRESH_DRY_RUN' | 'REFRESH_PLIKE' | 'REFRESH_TRAIN';

export function getRunbookTrigger(activityId: string): RunbookTrigger | null {
  if (activityId === 'prod_to_int_copy') return 'int';
  if (activityId === 'env_refresh')      return 'qa';
  if (activityId === 'dry_run')          return 'REFRESH_DRY_RUN';
  if (activityId === 'plike')            return 'REFRESH_PLIKE';
  if (activityId === 'training')         return 'REFRESH_TRAIN';
  return null;
}

// Same trigger→planId mapping as this component's own `defaultPlan()` —
// exported so callers that need to check a runbook's saved/completion state
// from the outside (e.g. HomeDashboard's activity reminders) address the
// exact same RunbookEntry rows this modal reads/writes, without duplicating
// the isInt/isQa special-casing.
export function getRunbookPlanId(trigger: RunbookTrigger): string {
  if (trigger === 'int') return 'REFRESH_INT_FULL';
  if (trigger === 'qa')  return 'REFRESH_QA_PREP';
  return trigger;
}

// ── Utils ──────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const DOW = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  // Unified DD/MM/YYYY date (2026-08-31 spec) — weekday name kept as
  // supplementary context specific to the runbook's operational schedule,
  // not just a stylistic date-format difference.
  return `${formatDate(d)} (יום ${DOW[d.getDay()]})`;
}

// Combines the runbook run's calendar date (dateStartISO) with a step's "HH:MM"
// time-of-day string into a real Date — steps have no date of their own.
function combineDateAndTime(dateISO: string, hhmm: string): Date | null {
  if (!dateISO || !hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(dateISO);
  d.setHours(h, m, 0, 0);
  return d;
}

function emptyRow(step: RunbookStep): RowData {
  return { employee: '', employeeUserId: null, startTime: step.startTime, endTime: step.endTime, team: '', status: 'pending' };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface TeamPickerProps {
  teams:      TeamOption[];
  teamValue:  string;
  empValue:   string;
  inputStyle: React.CSSProperties;
  onTeam:     (t: string) => void;
  onEmp:      (e: string) => void;
}

function TeamPicker({ teams, teamValue, empValue, inputStyle, onTeam, onEmp }: TeamPickerProps) {
  const matched = teams.find(t => t.name === teamValue);
  const members = matched?.members ?? [];

  return (
    <>
      {/* Team select */}
      <select
        value={teamValue}
        onChange={e => { onTeam(e.target.value); onEmp(''); }}
        style={inputStyle}
      >
        <option value="">-- בחר צוות --</option>
        {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
      </select>

      {/* Employee select (from team) or free text */}
      {members.length > 0 ? (
        <select value={empValue} onChange={e => onEmp(e.target.value)} style={inputStyle}>
          <option value="">-- בחר עובד --</option>
          {members.map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
        </select>
      ) : (
        <input
          value={empValue}
          onChange={e => onEmp(e.target.value)}
          placeholder="שם עובד"
          style={inputStyle}
        />
      )}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  trigger:          RunbookTrigger;
  dateStartISO:     string;
  versionId:        string;
  token:            string;
  startInRunMode?:  boolean;
  onClose:          () => void;
}

export default function RunbookModal({ trigger, dateStartISO, versionId, token, startInRunMode, onClose }: Props) {
  const headers = { Authorization: `Bearer ${token}` };
  const isInt = trigger === 'int';
  const isQa  = trigger === 'qa';

  const defaultPlan = (): string => getRunbookPlanId(trigger);

  const [planId,      setPlanId]      = useState<string>(defaultPlan());
  const [steps,       setSteps]       = useState<EditableStep[]>([]);
  const [rows,        setRows]        = useState<RowData[]>([]);
  const [teams,       setTeams]       = useState<TeamOption[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [editingSteps, setEditingSteps]     = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved]   = useState(false);
  const [addingStep,  setAddingStep]  = useState(false);

  // Replace state — employee
  const [repEmpFrom,   setRepEmpFrom]   = useState('');
  const [repEmpTo,     setRepEmpTo]     = useState('');
  const [repEmpToTeam, setRepEmpToTeam] = useState('');
  // Replace state — team
  const [repTeamFrom, setRepTeamFrom] = useState('');
  const [repTeamTo,   setRepTeamTo]   = useState('');

  const [runMode,       setRunMode]       = useState(!!startInRunMode);
  const [nearOnly,      setNearOnly]      = useState(false);
  const [savingStatus,  setSavingStatus]  = useState<number | null>(null);

  const def = RUNBOOKS[planId];

  useEffect(() => {
    axios.get(`${API}/teams`, { headers })
      .then(r => setTeams(
        (r.data as any[]).map((t: any) => ({
          id: t.id,
          name: t.name,
          members: (t.members ?? []).map((m: any) => ({ id: m.user?.id ?? m.id, fullName: m.user?.fullName ?? m.fullName ?? '', email: m.user?.email ?? m.email ?? '' })),
        }))
      ))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id: string) => {
    const [entriesRes, templateRes] = await Promise.all([
      axios.get(`${API}/runbook/${versionId}/${id}`, { headers }).catch(() => null),
      axios.get(`${API}/runbook/templates/${id}`, { headers }).catch(() => null),
    ]);
    const db: { stepIndex: number; employee: string; employeeUserId: string | null; startTime: string; endTime: string; team: string; status: string }[] = entriesRes?.data ?? [];
    const dbTemplate = templateRes?.data;
    const effectiveSteps: EditableStep[] = dbTemplate?.steps ?? toEditable(RUNBOOKS[id].steps);
    setSteps(effectiveSteps);
    setRows(effectiveSteps.map(step => {
      const e = db.find(x => x.stepIndex === step.key);
      return e
        ? { employee: e.employee ?? '', employeeUserId: e.employeeUserId ?? null, startTime: e.startTime || step.startTime, endTime: e.endTime || step.endTime, team: e.team ?? '', status: e.status || 'pending' }
        : emptyRow(step);
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  useEffect(() => { load(planId); }, [planId, load]);

  const setRow = (i: number, patch: Partial<RowData>) =>
    setRows(prev => { const next = [...prev]; next[i] = { ...next[i], ...patch }; return next; });

  const setStep = (i: number, patch: Partial<EditableStep>) =>
    setSteps(prev => { const next = [...prev]; next[i] = { ...next[i], ...patch }; return next; });

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/runbook/${versionId}/${planId}/save`, {
        entries: rows.map((r, i) => ({ stepIndex: steps[i].key, ...r, runDate: dateStartISO || null })),
      }, { headers });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  // Run mode: status changes persist immediately (not gated on the manual "שמור"
  // button) — this is now a live execution board, not a draft being edited.
  const handleStatusChange = async (i: number, status: string) => {
    const nextRows = [...rows];
    nextRows[i] = { ...nextRows[i], status };
    setRows(nextRows);
    setSavingStatus(i);
    try {
      await axios.post(`${API}/runbook/${versionId}/${planId}/save`, {
        entries: nextRows.map((r, idx) => ({ stepIndex: steps[idx].key, ...r, runDate: dateStartISO || null })),
      }, { headers });
    } finally {
      setSavingStatus(null);
    }
  };

  // Persists the current (possibly edited/added/deleted) step list as the
  // template override for this plan — future loads of this planId use it
  // instead of the hardcoded RUNBOOKS default.
  const saveAsTemplate = async () => {
    setSavingTemplate(true);
    try {
      await axios.post(`${API}/runbook/templates/${planId}`, {
        title: def.title, envLabel: def.envLabel, steps,
      }, { headers });
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2000);
    } finally { setSavingTemplate(false); }
  };

  const addStep = async () => {
    setAddingStep(true);
    try {
      const res = await axios.post(`${API}/runbook/templates/${planId}/steps`, {
        title: def.title, envLabel: def.envLabel, steps,
        afterKey: null,
        newStep: { num: steps.length + 1, activity: '', defaultTeam: '', duration: '', startTime: '', endTime: '' },
      }, { headers });
      const newSteps: EditableStep[] = res.data.steps;
      setSteps(newSteps);
      setRows(prev => [...prev, emptyRow(newSteps[newSteps.length - 1])]);
    } finally { setAddingStep(false); }
  };

  const deleteStep = (key: number) => {
    const idx = steps.findIndex(s => s.key === key);
    if (idx === -1) return;
    setSteps(prev => prev.filter(s => s.key !== key));
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const EMPTY_SENTINEL = '__EMPTY__';

  const handleReplaceEmp = async () => {
    if (!repEmpFrom.trim()) return;
    const toMember = teams.flatMap(t => t.members).find(m => m.fullName === repEmpTo);
    if (repEmpFrom === EMPTY_SENTINEL) {
      await axios.post(`${API}/runbook/${versionId}/${planId}/fill-empty`, {
        employee: repEmpTo, employeeUserId: toMember?.id ?? null, team: repEmpToTeam,
      }, { headers });
    } else {
      await axios.post(`${API}/runbook/${versionId}/${planId}/replace`, { from: repEmpFrom, to: repEmpTo }, { headers });
    }
    await load(planId);
    setRepEmpFrom(''); setRepEmpTo('');
  };

  const handleReplaceTeam = async () => {
    if (!repTeamFrom.trim()) return;
    await axios.post(`${API}/runbook/${versionId}/${planId}/replace-team`, { from: repTeamFrom, to: repTeamTo }, { headers });
    await load(planId);
    setRepTeamFrom(''); setRepTeamTo('');
  };

  const inputSmClass = 'box-border w-full rounded-sm border border-border bg-card px-2 py-1 font-sans text-sm text-foreground outline-none';

  // Column order: # | פעילות | משך | התחלה | סיום | צוות | עובד | סטטוס
  // Last column holds a compact status <select> in edit mode, but up to 3
  // action buttons (▶ התחל / ✓ סיים / 🚫 בעיה) in run mode — 92px only fits
  // the select, so it needs much more room once buttons replace it.
  const COLS = runMode
    ? '28px 1fr 55px 85px 85px 130px 130px 240px'
    : '28px 1fr 55px 85px 85px 130px 130px 92px';
  const HDRS = ['#', 'פעילות', 'משך', 'התחלה', 'סיום', 'צוות', 'עובד', 'סטטוס'];

  const staffed   = rows.filter(r => r.employee?.trim()).length;
  const doneCount = rows.filter(r => r.status === 'done').length;
  const issueCount = rows.filter(r => r.status === 'issue').length;

  return (
    <div
      dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-black/55 pt-8"
    >
      <div className="mb-8 flex max-h-[92vh] w-[96vw] max-w-[1180px] flex-col overflow-hidden rounded-xl bg-card shadow-xl">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center gap-3 bg-primary px-5 py-4">
          <span className="text-2xl">📋</span>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold text-white">
              {isInt                          ? 'היערכות לבדיקות אינטגרציה'
               : isQa                         ? 'היערכות לבדיקות QA'
               : trigger === 'REFRESH_DRY_RUN'  ? 'היערכות לחזרה גנרלית'
               : trigger === 'REFRESH_PLIKE'    ? 'סביבת PLIKE — רענון ויישור גרסה'
               : trigger === 'REFRESH_TRAIN'    ? 'סביבת TRAIN — רענון ויישור גרסה'
               : ''}
            </div>
            <div className="mt-1 text-sm text-white/85">
              {def.title}
              {' · '}
              <span className="font-semibold">{def.envLabel}</span>
              {dateStartISO ? ` · ${fmtDate(dateStartISO)}` : ''}
            </div>
          </div>

          <div className="rounded-full bg-white/[.18] px-3.5 py-1 text-[17px] font-bold text-white">
            {runMode ? doneCount : staffed}/{steps.length}
          </div>

          {(isInt || isQa) && !runMode && (
            <div className="flex gap-0.5 rounded-md bg-white/15 p-[3px]">
              {(isInt
                ? ['REFRESH_INT_FULL',  'REFRESH_INT_BILLY'] as const
                : ['REFRESH_QA_PREP',   'REFRESH_QA_BILLY']  as const
              ).map(id => (
                <button
                  key={id}
                  onClick={() => setPlanId(id)}
                  className={`rounded-sm border-none px-3.5 py-1 font-sans text-xs transition-[background,color] duration-150 ease-out ${planId === id ? 'bg-white font-bold text-primary' : 'bg-transparent font-normal text-white'} cursor-pointer`}
                >
                  {(id === 'REFRESH_INT_FULL' || id === 'REFRESH_QA_PREP') ? "מסלול א'" : "מסלול ב'"}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setRunMode(v => !v)}
            className={`cursor-pointer rounded-md border border-white/50 px-4 py-1.5 font-sans text-xs font-bold ${runMode ? 'bg-white text-primary' : 'bg-white/15 text-white'}`}
          >
            {runMode ? '✏️ חזור לעריכה' : '▶ הפעל במצב הרצה'}
          </button>

          {!runMode && (
            <button
              onClick={() => setShowReplace(v => !v)}
              className={`cursor-pointer rounded-md border border-white/40 px-3.5 py-1.5 font-sans text-xs font-semibold text-white ${showReplace ? 'bg-white/[.28]' : 'bg-white/15'}`}
            >
              🔄 החלפה
            </button>
          )}
          {!runMode && (
            <button
              onClick={() => setEditingSteps(v => !v)}
              className={`cursor-pointer rounded-md border border-white/40 px-3.5 py-1.5 font-sans text-xs font-semibold text-white ${editingSteps ? 'bg-white/[.28]' : 'bg-white/15'}`}
            >
              🛠 ערוך שלבים
            </button>
          )}
          {!runMode && editingSteps && (
            <button
              onClick={saveAsTemplate}
              disabled={savingTemplate}
              className={`rounded-md border-none px-3.5 py-1.5 font-sans text-xs font-bold ${templateSaved ? 'bg-success text-white' : 'bg-white text-primary'} ${savingTemplate ? 'cursor-wait opacity-70' : 'cursor-pointer opacity-100'}`}
            >
              {templateSaved ? '✓ התבנית נשמרה' : savingTemplate ? 'שומר…' : '📑 שמור כתבנית'}
            </button>
          )}
          {!runMode && (
            <button
              onClick={handleSave}
              disabled={saving}
              className={`rounded-md border-none px-[18px] py-1.5 font-sans text-xs font-bold transition-colors duration-300 ${saved ? 'bg-success text-white' : 'bg-white text-primary'} ${saving ? 'cursor-wait opacity-70' : 'cursor-pointer opacity-100'}`}
            >
              {saved ? '✓ נשמר' : saving ? 'שומר…' : '💾 שמור'}
            </button>
          )}
          <button onClick={onClose} className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full border-none bg-white/[.18] font-sans text-base leading-none text-white">✕</button>
        </div>

        {/* ── Run-mode filter bar ── */}
        {runMode && (
          <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" checked={nearOnly} onChange={e => setNearOnly(e.target.checked)} />
              הצג רק שלבים ב-15 הדקות הקרובות
            </label>
          </div>
        )}

        {/* ── Replace panel ── */}
        {showReplace && (
          <div className="flex flex-col gap-2 border-b border-border bg-[#E6E7F5] px-5 py-3">
            {/* Replace employee row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[60px] text-xs font-bold text-subtle-foreground">עובד:</span>
              <select
                value={repEmpFrom}
                onChange={e => setRepEmpFrom(e.target.value)}
                className={`${inputSmClass} w-40`}
              >
                <option value="">-- מי להחליף --</option>
                {rows.some(r => !r.employee?.trim()) && (
                  <option value={EMPTY_SENTINEL}>-- ריק (לא מאויש) --</option>
                )}
                {Array.from(new Set(rows.map(r => r.employee).filter(Boolean))).map(emp => (
                  <option key={emp} value={emp}>{emp}</option>
                ))}
              </select>
              <span className="text-xs text-subtle-foreground">→</span>
              <select
                value={repEmpToTeam}
                onChange={e => { setRepEmpToTeam(e.target.value); setRepEmpTo(''); }}
                className={`${inputSmClass} w-[130px]`}
              >
                <option value="">-- סנן לפי צוות --</option>
                {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <select
                value={repEmpTo}
                onChange={e => setRepEmpTo(e.target.value)}
                className={`${inputSmClass} w-40`}
              >
                <option value="">-- במי להחליף --</option>
                {(repEmpToTeam
                  ? teams.filter(t => t.name === repEmpToTeam).flatMap(t => t.members)
                  : teams.flatMap(t => t.members)
                ).map(m => (
                  <option key={m.id} value={m.fullName}>{m.fullName}</option>
                ))}
              </select>
              <button
                onClick={handleReplaceEmp}
                disabled={!repEmpFrom.trim()}
                className="rounded-md border-none px-3.5 py-1 font-sans text-xs font-bold"
                style={{
                  background: repEmpFrom.trim() ? BLUE : C.bgHover,
                  color: repEmpFrom.trim() ? '#fff' : C.textDisabled,
                  cursor: repEmpFrom.trim() ? 'pointer' : 'not-allowed',
                }}
              >{repEmpFrom === EMPTY_SENTINEL ? 'שבץ בכל השורות הריקות' : 'החלף'}</button>
            </div>

            {/* Replace team row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[60px] text-xs font-bold text-subtle-foreground">צוות:</span>
              <select
                value={repTeamFrom}
                onChange={e => setRepTeamFrom(e.target.value)}
                className={`${inputSmClass} w-40`}
              >
                <option value="">-- מי להחליף --</option>
                {Array.from(new Set(rows.map(r => r.team).filter(Boolean))).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="text-xs text-subtle-foreground">→</span>
              <select
                value={repTeamTo}
                onChange={e => setRepTeamTo(e.target.value)}
                className={`${inputSmClass} w-40`}
              >
                <option value="">-- במה להחליף --</option>
                {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button
                onClick={handleReplaceTeam}
                disabled={!repTeamFrom.trim()}
                className="rounded-md border-none px-3.5 py-1 font-sans text-xs font-bold"
                style={{
                  background: repTeamFrom.trim() ? BLUE : C.bgHover,
                  color: repTeamFrom.trim() ? '#fff' : C.textDisabled,
                  cursor: repTeamFrom.trim() ? 'pointer' : 'not-allowed',
                }}
              >החלף</button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div
            className="sticky top-0 z-[1] grid border-b-2 border-border bg-muted px-4 py-2"
            style={{ gridTemplateColumns: COLS }}
          >
            {HDRS.map((h, i) => (
              <div key={i} className="text-xs font-bold uppercase tracking-wide text-subtle-foreground">
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {steps.map((step, i) => {
            const row  = rows[i] ?? emptyRow(step);
            const scfg = statusCfg(row.status);
            const isEditingThisStep = editingSteps && !runMode;

            if (runMode && nearOnly && row.status !== 'in_progress') {
              const start = combineDateAndTime(dateStartISO, row.startTime);
              if (start) {
                const diffMin = (start.getTime() - Date.now()) / 60000;
                if (row.status === 'done' || diffMin > 15 || diffMin < -30) return null;
              }
            }

            return (
              <div
                key={step.key}
                className="grid items-center gap-1 border-b border-border px-4 py-2"
                style={{
                  gridTemplateColumns: COLS,
                  borderInlineEnd: `3px solid ${row.status === 'pending' ? 'transparent' : scfg.color}`,
                  background: row.status === 'done' ? C.bgNested : step.bold ? 'rgba(240,106,106,0.05)' : C.bgCard,
                  opacity: row.status === 'done' ? 0.7 : 1,
                }}
              >
                <div className="flex items-center gap-0.5 text-[13px] font-bold text-subtle-foreground">
                  {isEditingThisStep && (
                    <button
                      onClick={() => deleteStep(step.key)}
                      title="מחק שלב"
                      className="cursor-pointer border-none bg-transparent p-0 text-[13px] leading-none text-[#dc3545]"
                    >🗑</button>
                  )}
                  {i + 1}
                </div>

                {isEditingThisStep ? (
                  <div className="flex flex-col gap-1 ps-2">
                    <input
                      value={step.activity}
                      onChange={e => setStep(i, { activity: e.target.value })}
                      placeholder="שם הפעילות"
                      className={`${inputSmClass} font-semibold`}
                    />
                    <div className="flex gap-1">
                      <input value={step.defaultTeam} onChange={e => setStep(i, { defaultTeam: e.target.value })} placeholder="צוות ברירת מחדל" className={`${inputSmClass} w-[100px] text-xs`} />
                      <input value={step.startTime}   onChange={e => setStep(i, { startTime: e.target.value })}   placeholder="התחלה"           className={`${inputSmClass} w-[60px] text-xs`} />
                      <input value={step.endTime}     onChange={e => setStep(i, { endTime: e.target.value })}     placeholder="סיום"             className={`${inputSmClass} w-[60px] text-xs`} />
                    </div>
                  </div>
                ) : (
                  <div className={`ps-2 text-base text-foreground ${step.bold ? 'font-bold' : 'font-medium'}`}>
                    {step.activity}
                  </div>
                )}

                {isEditingThisStep ? (
                  <input
                    value={step.duration}
                    onChange={e => setStep(i, { duration: e.target.value })}
                    placeholder="משך"
                    className={`${inputSmClass} text-xs`}
                  />
                ) : (
                  <div className="whitespace-nowrap text-[13px] text-subtle-foreground">{step.duration}</div>
                )}

                {runMode ? (
                  <>
                    <div className="text-sm font-semibold text-foreground">{row.startTime}</div>
                    <div className="text-sm font-semibold text-foreground">{row.endTime}</div>
                    <div className="text-sm text-muted-foreground">{row.team || step.defaultTeam}</div>
                    <div className={`text-sm ${row.employee ? 'font-normal text-foreground' : 'italic text-subtle-foreground'}`}>
                      {row.employee || 'לא משובץ'}
                    </div>

                    {/* Status action buttons — persist immediately */}
                    <div className="flex gap-1">
                      {row.status !== 'in_progress' && row.status !== 'done' && (
                        <button
                          onClick={() => handleStatusChange(i, 'in_progress')}
                          disabled={savingStatus === i}
                          className={`cursor-pointer rounded-sm border-none bg-warning px-2 py-1.5 text-[13px] font-bold text-white ${savingStatus === i ? 'opacity-60' : 'opacity-100'}`}
                        >▶ התחל</button>
                      )}
                      {row.status !== 'done' && (
                        <button
                          onClick={() => handleStatusChange(i, 'done')}
                          disabled={savingStatus === i}
                          className={`cursor-pointer rounded-sm border-none bg-success px-2 py-1.5 text-[13px] font-bold text-white ${savingStatus === i ? 'opacity-60' : 'opacity-100'}`}
                        >✓ סיים</button>
                      )}
                      {row.status !== 'issue' && (
                        <button
                          onClick={() => handleStatusChange(i, 'issue')}
                          disabled={savingStatus === i}
                          className={`cursor-pointer rounded-sm border border-[#dc354566] bg-transparent px-2 py-1.5 text-[13px] font-bold text-[#dc3545] ${savingStatus === i ? 'opacity-60' : 'opacity-100'}`}
                        >🚫 בעיה</button>
                      )}
                      {(row.status === 'done' || row.status === 'issue') && (
                        <button
                          onClick={() => handleStatusChange(i, 'pending')}
                          disabled={savingStatus === i}
                          className={`cursor-pointer rounded-sm border border-border bg-transparent px-2 py-1.5 text-[13px] text-subtle-foreground ${savingStatus === i ? 'opacity-60' : 'opacity-100'}`}
                        >↺ חזור</button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Start time */}
                    <input
                      value={row.startTime}
                      onChange={e => setRow(i, { startTime: e.target.value })}
                      placeholder="HH:MM"
                      className={inputSmClass}
                    />

                    {/* End time */}
                    <input
                      value={row.endTime}
                      onChange={e => setRow(i, { endTime: e.target.value })}
                      placeholder="HH:MM"
                      className={inputSmClass}
                    />

                    {/* Team select */}
                    <select
                      value={row.team}
                      onChange={e => setRow(i, { team: e.target.value, employee: '', employeeUserId: null })}
                      className={`${inputSmClass} ${row.team ? 'text-foreground' : 'text-subtle-foreground'}`}
                    >
                      <option value="">{step.defaultTeam}</option>
                      {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>

                    {/* Employee — select from team members if available, else text input */}
                    {(() => {
                      const matched = teams.find(t => t.name === row.team);
                      const members = matched?.members ?? [];
                      return members.length > 0 ? (
                        <select
                          value={row.employee}
                          onChange={e => {
                            const m = members.find(mm => mm.fullName === e.target.value);
                            setRow(i, { employee: e.target.value, employeeUserId: m?.id ?? null });
                          }}
                          className={`${inputSmClass} ${row.employee ? 'text-foreground' : 'text-subtle-foreground'}`}
                        >
                          <option value="">-- בחר עובד --</option>
                          {members.map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
                        </select>
                      ) : (
                        <input
                          value={row.employee}
                          onChange={e => setRow(i, { employee: e.target.value })}
                          placeholder="שם עובד"
                          className={inputSmClass}
                        />
                      );
                    })()}

                    {/* Status */}
                    <select
                      value={row.status}
                      onChange={e => setRow(i, { status: e.target.value })}
                      className={`${inputSmClass} cursor-pointer font-semibold`}
                      style={{ background: scfg.bg, color: scfg.color, border: `1px solid ${scfg.color}55` }}
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            );
          })}

          {editingSteps && !runMode && (
            <div className="border-b border-border px-4 py-3">
              <button
                onClick={addStep}
                disabled={addingStep}
                className={`rounded-md border border-dashed border-[#4573D2] bg-transparent px-4 py-1.5 font-sans text-xs font-bold text-[#4573D2] ${addingStep ? 'cursor-wait opacity-60' : 'cursor-pointer opacity-100'}`}
              >
                {addingStep ? 'מוסיף…' : '+ הוסף שלב'}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border bg-muted px-5 py-3">
            <span className="text-sm text-subtle-foreground">
              {staffed} / {steps.length} שלבים מאוישים
              {' · '}
              <span className="font-semibold text-[#28a745]">{doneCount} הושלמו</span>
              {issueCount > 0 && (
                <span className="font-semibold text-[#dc3545]">{' · '}{issueCount} בעיות</span>
              )}
            </span>
            <span className="text-xs text-subtle-foreground">שורות מודגשות = שלבים קריטיים</span>
          </div>
        </div>
      </div>
    </div>
  );
}
