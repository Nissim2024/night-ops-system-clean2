import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, TEXT, WEIGHT, SP, RADIUS, SHADOW, FONT } from '../../theme';

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

// ── Utils ──────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const dd  = String(d.getDate()).padStart(2, '0');
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const DOW = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  return `${dd}/${mm} (יום ${DOW[d.getDay()]})`;
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

  const defaultPlan = (): string => {
    if (isInt) return 'REFRESH_INT_FULL';
    if (isQa)  return 'REFRESH_QA_PREP';
    return trigger;
  };

  const [planId,      setPlanId]      = useState<string>(defaultPlan());
  const [rows,        setRows]        = useState<RowData[]>([]);
  const [teams,       setTeams]       = useState<TeamOption[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [showReplace, setShowReplace] = useState(false);

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
    const res = await axios.get(`${API}/runbook/${versionId}/${id}`, { headers }).catch(() => null);
    const db: { stepIndex: number; employee: string; employeeUserId: string | null; startTime: string; endTime: string; team: string; status: string }[] = res?.data ?? [];
    const plan = RUNBOOKS[id];
    setRows(plan.steps.map((step, idx) => {
      const e = db.find(x => x.stepIndex === idx);
      return e
        ? { employee: e.employee ?? '', employeeUserId: e.employeeUserId ?? null, startTime: e.startTime || step.startTime, endTime: e.endTime || step.endTime, team: e.team ?? '', status: e.status || 'pending' }
        : emptyRow(step);
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  useEffect(() => { load(planId); }, [planId, load]);

  const setRow = (i: number, patch: Partial<RowData>) =>
    setRows(prev => { const next = [...prev]; next[i] = { ...next[i], ...patch }; return next; });

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/runbook/${versionId}/${planId}/save`, {
        entries: rows.map((r, i) => ({ stepIndex: i, ...r, runDate: dateStartISO || null })),
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
        entries: nextRows.map((r, idx) => ({ stepIndex: idx, ...r, runDate: dateStartISO || null })),
      }, { headers });
    } finally {
      setSavingStatus(null);
    }
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

  const inputSm: React.CSSProperties = {
    padding: `4px ${SP[2]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm,
    background: C.bgCard, color: C.textPrimary, fontFamily: FONT, fontSize: 14,
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  };

  // Column order: # | פעילות | משך | התחלה | סיום | צוות | עובד | סטטוס | זימון
  const COLS = '28px 1fr 55px 85px 85px 130px 130px 92px';
  const HDRS = ['#', 'פעילות', 'משך', 'התחלה', 'סיום', 'צוות', 'עובד', 'סטטוס'];

  const staffed   = rows.filter(r => r.employee?.trim()).length;
  const doneCount = rows.filter(r => r.status === 'done').length;
  const issueCount = rows.filter(r => r.status === 'issue').length;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 32, overflowY: 'auto', direction: 'rtl',
      }}
    >
      <div style={{
        background: C.bgCard, borderRadius: RADIUS.xl, width: '96vw', maxWidth: 1180,
        boxShadow: SHADOW.xl, display: 'flex', flexDirection: 'column',
        marginBottom: 32, maxHeight: '92vh', overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: `${SP[4]} ${SP[5]}`, background: C.brand, display: 'flex', alignItems: 'center', gap: SP[3], flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 26 }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: WEIGHT.bold, color: 'white' }}>
              {isInt                          ? 'היערכות לבדיקות אינטגרציה'
               : isQa                         ? 'היערכות לבדיקות QA'
               : trigger === 'REFRESH_DRY_RUN'  ? 'היערכות לחזרה גנרלית'
               : trigger === 'REFRESH_PLIKE'    ? 'סביבת PLIKE — רענון ויישור גרסה'
               : trigger === 'REFRESH_TRAIN'    ? 'סביבת TRAIN — רענון ויישור גרסה'
               : ''}
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 3 }}>
              {def.title}
              {' · '}
              <span style={{ fontWeight: WEIGHT.semibold }}>{def.envLabel}</span>
              {dateStartISO ? ` · ${fmtDate(dateStartISO)}` : ''}
            </div>
          </div>

          <div style={{
            fontSize: 17, fontWeight: WEIGHT.bold, color: 'white',
            background: 'rgba(255,255,255,0.18)', borderRadius: RADIUS.full, padding: '4px 14px',
          }}>
            {staffed}/{def.steps.length}
          </div>

          {(isInt || isQa) && !runMode && (
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.15)', padding: 3, borderRadius: RADIUS.md }}>
              {(isInt
                ? ['REFRESH_INT_FULL',  'REFRESH_INT_BILLY'] as const
                : ['REFRESH_QA_PREP',   'REFRESH_QA_BILLY']  as const
              ).map(id => (
                <button key={id} onClick={() => setPlanId(id)} style={{
                  padding: `4px 14px`, borderRadius: RADIUS.sm, border: 'none',
                  background: planId === id ? 'white' : 'transparent',
                  color: planId === id ? C.brand : 'white',
                  fontFamily: FONT, ...TEXT.xs,
                  fontWeight: planId === id ? WEIGHT.bold : WEIGHT.normal,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {(id === 'REFRESH_INT_FULL' || id === 'REFRESH_QA_PREP') ? "מסלול א'" : "מסלול ב'"}
                </button>
              ))}
            </div>
          )}

          <button onClick={() => setRunMode(v => !v)} style={{
            padding: `6px 16px`, borderRadius: RADIUS.md, border: `1px solid rgba(255,255,255,0.5)`,
            background: runMode ? 'white' : 'rgba(255,255,255,0.15)', color: runMode ? C.brand : 'white',
            fontFamily: FONT, ...TEXT.xs, cursor: 'pointer', fontWeight: WEIGHT.bold,
          }}>
            {runMode ? '✏️ חזור לעריכה' : '▶ הפעל במצב הרצה'}
          </button>

          {!runMode && (
            <button onClick={() => setShowReplace(v => !v)} style={{
              padding: `6px 14px`, borderRadius: RADIUS.md, border: `1px solid rgba(255,255,255,0.4)`,
              background: showReplace ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.15)', color: 'white',
              fontFamily: FONT, ...TEXT.xs, cursor: 'pointer', fontWeight: WEIGHT.semibold,
            }}>
              🔄 החלפה
            </button>
          )}
          {!runMode && (
            <button onClick={handleSave} disabled={saving} style={{
              padding: `6px 18px`, borderRadius: RADIUS.md, border: 'none',
              background: saved ? C.success : 'white', color: saved ? 'white' : C.brand,
              fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold,
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
              transition: 'background 0.3s',
            }}>
              {saved ? '✓ נשמר' : saving ? 'שומר…' : '💾 שמור'}
            </button>
          )}
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: '50%', border: 'none',
            background: 'rgba(255,255,255,0.18)', color: 'white',
            fontFamily: FONT, fontSize: 16, cursor: 'pointer', lineHeight: '1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* ── Run-mode filter bar ── */}
        {runMode && (
          <div style={{
            padding: `${SP[2]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`,
            background: C.bgNested, display: 'flex', alignItems: 'center', gap: SP[2],
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: C.textSecondary, cursor: 'pointer' }}>
              <input type="checkbox" checked={nearOnly} onChange={e => setNearOnly(e.target.checked)} />
              הצג רק שלבים ב-15 הדקות הקרובות
            </label>
          </div>
        )}

        {/* ── Replace panel ── */}
        {showReplace && (
          <div style={{
            padding: `${SP[3]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`,
            background: C.bgActive, display: 'flex', flexDirection: 'column', gap: SP[2],
          }}>
            {/* Replace employee row */}
            <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, minWidth: 60 }}>עובד:</span>
              <select
                value={repEmpFrom}
                onChange={e => setRepEmpFrom(e.target.value)}
                style={{ ...inputSm, width: 160 }}
              >
                <option value="">-- מי להחליף --</option>
                {rows.some(r => !r.employee?.trim()) && (
                  <option value={EMPTY_SENTINEL}>-- ריק (לא מאויש) --</option>
                )}
                {Array.from(new Set(rows.map(r => r.employee).filter(Boolean))).map(emp => (
                  <option key={emp} value={emp}>{emp}</option>
                ))}
              </select>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>→</span>
              <select
                value={repEmpToTeam}
                onChange={e => { setRepEmpToTeam(e.target.value); setRepEmpTo(''); }}
                style={{ ...inputSm, width: 130 }}
              >
                <option value="">-- סנן לפי צוות --</option>
                {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <select
                value={repEmpTo}
                onChange={e => setRepEmpTo(e.target.value)}
                style={{ ...inputSm, width: 160 }}
              >
                <option value="">-- במי להחליף --</option>
                {(repEmpToTeam
                  ? teams.filter(t => t.name === repEmpToTeam).flatMap(t => t.members)
                  : teams.flatMap(t => t.members)
                ).map(m => (
                  <option key={m.id} value={m.fullName}>{m.fullName}</option>
                ))}
              </select>
              <button onClick={handleReplaceEmp} disabled={!repEmpFrom.trim()} style={{
                padding: `4px 14px`, borderRadius: RADIUS.md, border: 'none',
                background: repEmpFrom.trim() ? BLUE : C.bgHover,
                color: repEmpFrom.trim() ? '#fff' : C.textDisabled,
                fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold,
                cursor: repEmpFrom.trim() ? 'pointer' : 'not-allowed',
              }}>{repEmpFrom === EMPTY_SENTINEL ? 'שבץ בכל השורות הריקות' : 'החלף'}</button>
            </div>

            {/* Replace team row */}
            <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.bold, minWidth: 60 }}>צוות:</span>
              <select
                value={repTeamFrom}
                onChange={e => setRepTeamFrom(e.target.value)}
                style={{ ...inputSm, width: 160 }}
              >
                <option value="">-- מי להחליף --</option>
                {Array.from(new Set(rows.map(r => r.team).filter(Boolean))).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>→</span>
              <select
                value={repTeamTo}
                onChange={e => setRepTeamTo(e.target.value)}
                style={{ ...inputSm, width: 160 }}
              >
                <option value="">-- במה להחליף --</option>
                {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button onClick={handleReplaceTeam} disabled={!repTeamFrom.trim()} style={{
                padding: `4px 14px`, borderRadius: RADIUS.md, border: 'none',
                background: repTeamFrom.trim() ? BLUE : C.bgHover,
                color: repTeamFrom.trim() ? '#fff' : C.textDisabled,
                fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold,
                cursor: repTeamFrom.trim() ? 'pointer' : 'not-allowed',
              }}>החלף</button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: COLS,
            padding: `${SP[2]} ${SP[4]}`,
            borderBottom: `2px solid ${C.border}`,
            background: C.bgNested,
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            {HDRS.map((h, i) => (
              <div key={i} style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {def.steps.map((step, i) => {
            const row  = rows[i] ?? emptyRow(step);
            const scfg = statusCfg(row.status);

            if (runMode && nearOnly && row.status !== 'in_progress') {
              const start = combineDateAndTime(dateStartISO, row.startTime);
              if (start) {
                const diffMin = (start.getTime() - Date.now()) / 60000;
                if (row.status === 'done' || diffMin > 15 || diffMin < -30) return null;
              }
            }

            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: COLS,
                padding: `${SP[2]} ${SP[4]}`,
                borderBottom: `1px solid ${C.border}`,
                borderRight: `3px solid ${row.status === 'pending' ? 'transparent' : scfg.color}`,
                background: row.status === 'done' ? C.bgNested : step.bold ? 'rgba(240,106,106,0.05)' : C.bgCard,
                opacity: row.status === 'done' ? 0.7 : 1,
                alignItems: 'center', gap: SP[1],
              }}>
                <div style={{ fontSize: 13, color: C.textMuted, fontWeight: WEIGHT.bold }}>{step.num}</div>

                <div style={{ fontSize: 16, color: C.textPrimary, fontWeight: step.bold ? WEIGHT.bold : WEIGHT.medium, paddingLeft: SP[2] }}>
                  {step.activity}
                </div>

                <div style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>{step.duration}</div>

                {runMode ? (
                  <>
                    <div style={{ fontSize: 14, color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{row.startTime}</div>
                    <div style={{ fontSize: 14, color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{row.endTime}</div>
                    <div style={{ fontSize: 14, color: C.textSecondary }}>{row.team || step.defaultTeam}</div>
                    <div style={{ fontSize: 14, color: row.employee ? C.textPrimary : C.textMuted, fontStyle: row.employee ? 'normal' : 'italic' }}>
                      {row.employee || 'לא משובץ'}
                    </div>

                    {/* Status action buttons — persist immediately */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {row.status !== 'in_progress' && row.status !== 'done' && (
                        <button
                          onClick={() => handleStatusChange(i, 'in_progress')}
                          disabled={savingStatus === i}
                          style={{ background: C.statusInProgress, color: 'white', border: 'none', borderRadius: RADIUS.sm, padding: '5px 8px', fontSize: 13, fontWeight: WEIGHT.bold, cursor: 'pointer', opacity: savingStatus === i ? 0.6 : 1 }}
                        >▶ התחל</button>
                      )}
                      {row.status !== 'done' && (
                        <button
                          onClick={() => handleStatusChange(i, 'done')}
                          disabled={savingStatus === i}
                          style={{ background: C.success, color: 'white', border: 'none', borderRadius: RADIUS.sm, padding: '5px 8px', fontSize: 13, fontWeight: WEIGHT.bold, cursor: 'pointer', opacity: savingStatus === i ? 0.6 : 1 }}
                        >✓ סיים</button>
                      )}
                      {row.status !== 'issue' && (
                        <button
                          onClick={() => handleStatusChange(i, 'issue')}
                          disabled={savingStatus === i}
                          style={{ background: 'transparent', color: '#dc3545', border: '1px solid #dc354566', borderRadius: RADIUS.sm, padding: '5px 8px', fontSize: 13, fontWeight: WEIGHT.bold, cursor: 'pointer', opacity: savingStatus === i ? 0.6 : 1 }}
                        >🚫 בעיה</button>
                      )}
                      {(row.status === 'done' || row.status === 'issue') && (
                        <button
                          onClick={() => handleStatusChange(i, 'pending')}
                          disabled={savingStatus === i}
                          style={{ background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: '5px 8px', fontSize: 13, cursor: 'pointer', opacity: savingStatus === i ? 0.6 : 1 }}
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
                      style={inputSm}
                    />

                    {/* End time */}
                    <input
                      value={row.endTime}
                      onChange={e => setRow(i, { endTime: e.target.value })}
                      placeholder="HH:MM"
                      style={inputSm}
                    />

                    {/* Team select */}
                    <select
                      value={row.team}
                      onChange={e => setRow(i, { team: e.target.value, employee: '', employeeUserId: null })}
                      style={{ ...inputSm, color: row.team ? C.textPrimary : C.textMuted }}
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
                          style={{ ...inputSm, color: row.employee ? C.textPrimary : C.textMuted }}
                        >
                          <option value="">-- בחר עובד --</option>
                          {members.map(m => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
                        </select>
                      ) : (
                        <input
                          value={row.employee}
                          onChange={e => setRow(i, { employee: e.target.value })}
                          placeholder="שם עובד"
                          style={inputSm}
                        />
                      );
                    })()}

                    {/* Status */}
                    <select
                      value={row.status}
                      onChange={e => setRow(i, { status: e.target.value })}
                      style={{
                        ...inputSm,
                        background: scfg.bg,
                        color: scfg.color,
                        fontWeight: WEIGHT.semibold,
                        border: `1px solid ${scfg.color}55`,
                        cursor: 'pointer',
                      }}
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

          {/* Footer */}
          <div style={{
            padding: `${SP[3]} ${SP[5]}`, borderTop: `1px solid ${C.border}`,
            background: C.bgNested,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 14, color: C.textMuted }}>
              {staffed} / {def.steps.length} שלבים מאוישים
              {' · '}
              <span style={{ color: '#28a745', fontWeight: WEIGHT.semibold }}>{doneCount} הושלמו</span>
              {issueCount > 0 && (
                <span style={{ color: '#dc3545', fontWeight: WEIGHT.semibold }}>{' · '}{issueCount} בעיות</span>
              )}
            </span>
            <span style={{ ...TEXT.xs, color: C.textDisabled }}>שורות מודגשות = שלבים קריטיים</span>
          </div>
        </div>
      </div>
    </div>
  );
}
