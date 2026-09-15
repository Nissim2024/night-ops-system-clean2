import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { DateField, DateTimeField } from './DatePicker';
// DateField/DateTimeField (unmigrated) only accept a `style` prop, not
// className — the handful of style objects still feeding them below are the
// one deliberate exception to the className migration in this file. `C` is
// kept only for that purpose; every other visual has moved to Tailwind
// classes on the new design tokens.
import { C } from '../theme';
import { cn } from '../lib/utils';
import { formatTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

type StepStatus = 'done' | 'skipped' | null;
interface WizardState {
  step1: StepStatus;
  step2: StepStatus;
  step3: StepStatus;
  step4: StepStatus;
  step5: StepStatus;
}

interface PlanWizardProps {
  version: any;
  token: string;
  users: { id: string; fullName: string }[];
  teams: any[];
  onClose: () => void;
  onRefresh: () => void;
}

const STEP_LABELS = ['מסגרת זמן', 'עובדים', 'תלויות', 'חריגות', 'מיון'];

const PHASE_DEFAULTS = [
  { startH: 8,  startM: 0,  startOff: 0, endH: 15, endM: 29, endOff: 0 },
  { startH: 22, startM: 0,  startOff: 0, endH: 23, endM: 59, endOff: 0 },
  { startH: 23, startM: 45, startOff: 0, endH: 4,  endM: 20, endOff: 1 },
  { startH: 8,  startM: 0,  startOff: 1, endH: 16, endM: 15, endOff: 1 },
];

function utcToLocalInputStr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toUtcIso(str: string): string | undefined {
  if (!str) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function initPhaseTimes(version: any): { starts: Record<string, string>; ends: Record<string, string> } {
  const starts: Record<string, string> = {};
  const ends: Record<string, string> = {};
  const baseDate = version.plannedStart ? new Date(version.plannedStart) : null;
  const sortedPhases = [...(version.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

  for (let i = 0; i < sortedPhases.length; i++) {
    const phase = sortedPhases[i];
    const def = PHASE_DEFAULTS[i];

    if (phase.plannedStart) {
      starts[phase.id] = utcToLocalInputStr(phase.plannedStart);
    } else if (baseDate && def) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + def.startOff);
      d.setHours(def.startH, def.startM, 0, 0);
      starts[phase.id] = utcToLocalInputStr(d.toISOString());
    } else {
      starts[phase.id] = '';
    }

    if (phase.plannedEnd) {
      ends[phase.id] = utcToLocalInputStr(phase.plannedEnd);
    } else if (baseDate && def) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + def.endOff);
      d.setHours(def.endH, def.endM, 0, 0);
      ends[phase.id] = utcToLocalInputStr(d.toISOString());
    } else {
      ends[phase.id] = '';
    }
  }
  return { starts, ends };
}

interface WorkerEntry {
  key: string;
  displayName: string;
  teamId: string | null;
  isEmpty: boolean;
  isUnknown: boolean;
}

function getWorkerEntries(version: any, users: { id: string; fullName: string }[]): WorkerEntry[] {
  const namedMap = new Map<string, string | null>(); // name → teamId
  const emptyTeams = new Set<string>();              // teamIds with unassigned tasks

  for (const phase of version.phases ?? []) {
    for (const sub of phase.subPhases ?? []) {
      for (const task of sub.tasks ?? []) {
        if (task.assignedUserName) {
          const name = task.assignedUserName.trim();
          if (!namedMap.has(name)) namedMap.set(name, task.assignedTeam?.id ?? null);
        } else if (task.assignedTeam?.id) {
          emptyTeams.add(task.assignedTeam.id);
        }
      }
    }
  }

  const knownNames = new Set(users.map(u => u.fullName));
  const entries: WorkerEntry[] = [];

  Array.from(namedMap.entries()).forEach(([name, teamId]) => {
    entries.push({ key: name, displayName: name, teamId, isEmpty: false, isUnknown: !knownNames.has(name) });
  });
  entries.sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));

  Array.from(emptyTeams).forEach(teamId => {
    entries.push({ key: `__empty__:${teamId}`, displayName: 'לא משובץ', teamId, isEmpty: true, isUnknown: false });
  });

  return entries;
}

// ── Step content components ────────────────────────────────────────────────

function Step1Content({ version, phaseStarts, phaseEnds, setPhaseStarts, setPhaseEnds }: {
  version: any;
  phaseStarts: Record<string, string>;
  phaseEnds: Record<string, string>;
  setPhaseStarts: (v: Record<string, string>) => void;
  setPhaseEnds: (v: Record<string, string>) => void;
}) {
  const sortedPhases = [...(version.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

  // Derive initial base date from plannedStart or first phase with a plannedStart
  const deriveInitialBase = () => {
    if (version.plannedStart) return new Date(version.plannedStart).toISOString().slice(0, 10);
    for (const ph of sortedPhases) {
      if (ph.plannedStart) return new Date(ph.plannedStart).toISOString().slice(0, 10);
    }
    return '';
  };
  const [baseDate, setBaseDate] = useState(deriveInitialBase);

  const applyDefaults = (dateStr: string) => {
    if (!dateStr) return;
    const [year, month, day] = dateStr.split('-').map(Number);
    const fmt = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const newStarts: Record<string, string> = {};
    const newEnds:   Record<string, string> = {};
    for (let i = 0; i < sortedPhases.length; i++) {
      const phase = sortedPhases[i];
      const def   = PHASE_DEFAULTS[i];
      if (!def) continue;
      newStarts[phase.id] = fmt(new Date(year, month - 1, day + def.startOff, def.startH, def.startM, 0));
      newEnds[phase.id]   = fmt(new Date(year, month - 1, day + def.endOff,   def.endH,   def.endM,   0));
    }
    setPhaseStarts(newStarts);
    setPhaseEnds(newEnds);
  };

  return (
    <div>
      <h3 className="m-0 mb-2 text-sm text-foreground">📅 הגדרת מסגרת זמן</h3>
      <p className="m-0 mb-4 text-xs text-subtle-foreground">
        קבע שעת התחלה וסיום לכל שלב. המערכת תחשב את זמן כל משימה לפי מבנה התלויות.
      </p>

      {/* Base night date picker */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3.5 rounded-md border border-info/30 bg-info/10 px-4 py-3">
        <span className="whitespace-nowrap text-xs font-semibold text-info">🌙 תאריך לילה ההטמעה:</span>
        <DateField
          value={baseDate}
          onChange={v => setBaseDate(v)}
          style={{ padding: '6px 10px', border: `1px solid ${C.info}`, borderRadius: '6px', fontSize: '15px', background: 'white', color: C.textPrimary }}
        />
        <button
          onClick={() => applyDefaults(baseDate)}
          disabled={!baseDate}
          className={cn(
            'whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-semibold text-white transition-colors duration-fast ease-out',
            baseDate ? 'cursor-pointer bg-info hover:brightness-95' : 'cursor-not-allowed bg-subtle-foreground'
          )}
        >
          חשב ברירות מחדל ⚡
        </button>
        <span className="text-xs text-subtle-foreground">כל שעות השלבים יחושבו אוטומטית</span>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted">
            <th className="border-b-2 border-border px-3 py-2.5 text-right font-semibold text-foreground">שלב</th>
            <th className="border-b-2 border-border px-3 py-2.5 text-center font-semibold text-foreground">התחלה</th>
            <th className="border-b-2 border-border px-3 py-2.5 text-center font-semibold text-foreground">סיום</th>
          </tr>
        </thead>
        <tbody>
          {sortedPhases.map((phase: any) => (
            <tr key={phase.id} className="border-b border-muted">
              <td className="px-3 py-2.5 font-medium text-foreground">{phase.name}</td>
              <td className="px-3 py-2 text-center">
                <DateTimeField
                  value={phaseStarts[phase.id] ?? ''}
                  onChange={v => setPhaseStarts({ ...phaseStarts, [phase.id]: v })}
                  style={{ padding: '6px 10px', border: `1px solid ${C.borderEm}`, borderRadius: '6px', fontSize: '15px' }}
                />
              </td>
              <td className="px-3 py-2 text-center">
                <DateTimeField
                  value={phaseEnds[phase.id] ?? ''}
                  onChange={v => setPhaseEnds({ ...phaseEnds, [phase.id]: v })}
                  style={{ padding: '6px 10px', border: `1px solid ${C.borderEm}`, borderRadius: '6px', fontSize: '15px' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step2Content({ version, users, teams, workerReplacements, setWorkerReplacements }: {
  version: any;
  users: { id: string; fullName: string }[];
  teams: any[];
  workerReplacements: Record<string, { toUserId: string; phaseId: string }[]>;
  setWorkerReplacements: (v: Record<string, { toUserId: string; phaseId: string }[]>) => void;
}) {
  const entries = getWorkerEntries(version, users);
  const sortedPhases = [...(version.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

  if (entries.length === 0) {
    return (
      <div className="p-10 text-center text-subtle-foreground">
        <div className="mb-3 text-[32px]">👤</div>
        אין משימות עם צוות מוקצה בתוכנית זו
      </div>
    );
  }

  const emptyRow = { toUserId: '', phaseId: '' };
  const rowsFor = (key: string) => workerReplacements[key] ?? [emptyRow];

  const updateRow = (key: string, idx: number, patch: Partial<{ toUserId: string; phaseId: string }>) => {
    const rows = rowsFor(key).map((r, i) => i === idx ? { ...r, ...patch } : r);
    setWorkerReplacements({ ...workerReplacements, [key]: rows });
  };
  const addRow = (key: string) => {
    setWorkerReplacements({ ...workerReplacements, [key]: [...rowsFor(key), { ...emptyRow }] });
  };
  const removeRow = (key: string, idx: number) => {
    const rows = rowsFor(key).filter((_, i) => i !== idx);
    setWorkerReplacements({ ...workerReplacements, [key]: rows.length > 0 ? rows : [emptyRow] });
  };

  return (
    <div>
      <h3 className="m-0 mb-2 text-[17px] text-foreground">👥 החלפת עובדים</h3>
      <p className="m-0 mb-5 text-[15px] text-subtle-foreground">
        בחר מחליף לכל עובד מהתבנית. עזוב ריק כדי לשמור על העובד המקורי. ניתן להגביל את ההחלפה לשלב מסוים בלבד, במקום כל הגרסה —
        וניתן להוסיף כמה החלפות לאותו עובד, כל אחת עבור שלב אחר.
      </p>
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr className="bg-muted">
            <th className="border-b-2 border-border px-3 py-2.5 text-right font-semibold text-foreground">עובד בתבנית</th>
            <th className="border-b-2 border-border px-3 py-2.5 text-right font-semibold text-foreground">מחליף →</th>
            <th className="border-b-2 border-border px-3 py-2.5 text-right font-semibold text-foreground">תחולה</th>
            <th className="w-8 border-b-2 border-border" />
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const team = teams.find((t: any) => t.id === entry.teamId);
            const pool: { id: string; fullName: string }[] = team
              ? (team.members || []).map((m: any) => m.user).filter(Boolean)
              : users;
            const rows = rowsFor(entry.key);
            const usedPhaseIds = (excludeIdx: number) =>
              new Set(rows.filter((_, i) => i !== excludeIdx).map(r => r.phaseId).filter(Boolean));

            return rows.map((current, idx) => (
              <tr
                key={`${entry.key}:${idx}`}
                className={cn(
                  idx === rows.length - 1 ? 'border-b border-muted' : 'border-b-0',
                  entry.isEmpty ? 'bg-warning-bg' : 'bg-transparent'
                )}
              >
                <td className={cn('px-3 py-2.5', entry.isEmpty ? 'text-warning' : 'text-foreground')}>
                  {idx === 0 && (
                    <>
                      {entry.isEmpty ? (
                        <span>
                          <span className="me-1 text-warning">⚠</span>
                          לא משובץ
                        </span>
                      ) : (
                        <span>
                          {entry.displayName}
                          {entry.isUnknown && (
                            <span className="ms-1.5 text-[13px] text-danger" title="עובד לא פעיל / לא קיים במערכת">⚠ לא פעיל</span>
                          )}
                        </span>
                      )}
                      {team && (
                        <span className="ms-1.5 text-[13px] text-subtle-foreground">({team.name})</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={current.toUserId}
                    onChange={e => updateRow(entry.key, idx, { toUserId: e.target.value })}
                    className="w-full rounded-md border border-border bg-card px-2.5 py-[7px] text-[15px]"
                  >
                    <option value="">{entry.isEmpty ? '— בחר עובד לשיבוץ —' : '— ללא שינוי —'}</option>
                    {pool.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={current.phaseId}
                    disabled={!current.toUserId}
                    onChange={e => updateRow(entry.key, idx, { phaseId: e.target.value })}
                    className={cn(
                      'w-full rounded-md border border-border px-2.5 py-[7px] text-[15px]',
                      current.toUserId ? 'bg-card text-foreground' : 'bg-muted text-subtle-foreground'
                    )}
                    title="ברירת מחדל: כל הגרסה"
                  >
                    <option value="">כל הגרסה</option>
                    {sortedPhases.map((p: any) => (
                      <option key={p.id} value={p.id} disabled={usedPhaseIds(idx).has(p.id)}>רק שלב: {p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  {idx === rows.length - 1 ? (
                    <button
                      type="button"
                      title="הוסף החלפה נוספת לאותו עובד עבור שלב אחר"
                      onClick={() => addRow(entry.key)}
                      className="h-[26px] w-[26px] cursor-pointer rounded-md border border-border bg-transparent text-[15px] leading-none text-info"
                    >+</button>
                  ) : (
                    <button
                      type="button"
                      title="הסר החלפה זו"
                      onClick={() => removeRow(entry.key, idx)}
                      className="h-[26px] w-[26px] cursor-pointer rounded-md border border-border bg-transparent text-[15px] leading-none text-danger"
                    >✕</button>
                  )}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function Step3Content({ depsResult }: { depsResult: { created: number; skipped: number } | null }) {
  return (
    <div>
      <h3 className="m-0 mb-2 text-[17px] text-foreground">🔗 תלויות ועדכון זמנים</h3>
      <p className="m-0 mb-4 text-[15px] text-subtle-foreground">
        יצירת תלויות אוטומטיות בין משימות של אותו עובד (לפי סדר), ואחריה חישוב זמני ביצוע לפי שרשראות התלות.
      </p>

      <div className="mb-4 rounded-[10px] border border-border bg-muted px-5 py-4">
        <div className="mb-2 text-[15px] font-bold text-foreground">מה יקרה:</div>
        <ul className="m-0 ps-5 text-[15px] leading-[1.8] text-muted-foreground">
          <li>לכל עובד, כל משימה שלו תהיה תלויה במשימה הקודמת שלו (בתוך אותו שלב)</li>
          <li>תלויות קיימות לא יידרסו</li>
          <li>לאחר יצירת התלויות — המערכת תחשב מחדש את זמני כל המשימות</li>
        </ul>
      </div>

      <div className="rounded-[10px] border border-warning bg-warning-bg px-4 py-3 text-[15px] text-warning">
        💡 <strong>לחץ "רק חשב זמנים"</strong> אם כבר יצרת תלויות ורוצה רק לעדכן את הזמנים לפיהן.
      </div>

      {depsResult && (
        <div className="mt-4 rounded-md border border-success bg-success-bg px-4 py-3 text-[15px] text-success">
          ✅ נוצרו <strong>{depsResult.created}</strong> תלויות חדשות | דולגו (קיימות/מעגליות): <strong>{depsResult.skipped}</strong>
        </div>
      )}
    </div>
  );
}

function Step4Content({ anomalies, versionId, token, onRedetect }: {
  anomalies: any[] | null;
  versionId: string;
  token: string;
  onRedetect: () => void;
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const [editDur, setEditDur] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const saveDuration = async (taskId: string, original: string | null) => {
    const dur = (editDur[taskId] ?? original ?? '').trim();
    if (!dur) return;
    setSaving(taskId);
    setRowErrors(p => ({ ...p, [taskId]: '' }));
    try {
      await axios.patch(`${API}/tasks/${taskId}`, { duration: dur }, { headers });
      onRedetect();
    } catch {
      setRowErrors(p => ({ ...p, [taskId]: 'שגיאה בשמירה' }));
    } finally {
      setSaving(null);
    }
  };

  const removeDep = async (taskId: string, depTaskId: string, depTitle: string) => {
    const key = `${taskId}|${depTaskId}`;
    setRemoving(key);
    setRowErrors(p => ({ ...p, [taskId]: '' }));
    try {
      await axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId: depTaskId }, { headers });
      onRedetect();
    } catch {
      setRowErrors(p => ({ ...p, [taskId]: `שגיאה בהסרת תלות: ${depTitle}` }));
    } finally {
      setRemoving(null);
    }
  };

  const TH_CLASS = 'border-b-2 border-border bg-border px-2.5 py-[9px] text-sm font-bold text-foreground';

  if (anomalies === null) {
    return (
      <div>
        <h3 className="m-0 mb-2 text-[17px] text-foreground">🔍 בדיקת חריגות</h3>
        <p className="m-0 mb-5 text-[15px] text-subtle-foreground">
          בדיקה אם משימות כלשהן חורגות מסיום השלב המתוכנן.
        </p>
        <div className="p-10 text-center text-subtle-foreground">
          לחץ "בדוק חריגות" כדי לבצע את הבדיקה
        </div>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div>
        <h3 className="m-0 mb-2 text-[17px] text-foreground">🔍 בדיקת חריגות</h3>
        <div className="p-10 text-center">
          <div className="mb-3 text-[48px]">✅</div>
          <div className="text-[17px] font-bold text-success">לא נמצאו חריגות</div>
          <div className="mt-2 text-[15px] text-subtle-foreground">כל המשימות בתוך מסגרת הזמן של השלב</div>
        </div>
      </div>
    );
  }

  const byPhase: Record<string, any[]> = {};
  for (const a of anomalies) {
    if (!byPhase[a.phaseName]) byPhase[a.phaseName] = [];
    byPhase[a.phaseName].push(a);
  }

  return (
    <div>
      <h3 className="m-0 mb-2 text-[17px] text-foreground">🔍 בדיקת חריגות</h3>
      <div className="mb-4 rounded-md border border-danger bg-danger-bg px-4 py-3 text-[15px] font-bold text-danger">
        ⚠️ נמצאו {anomalies.length} חריגות — משימות שיסתיימו אחרי סיום השלב
      </div>

      {Object.entries(byPhase).map(([phaseName, items]) => (
        <div key={phaseName} className="mb-5">
          <div className="mb-2 rounded-md border-s-[3px] border-s-danger bg-danger-bg px-3 py-1.5 text-[15px] font-bold text-foreground">
            שלב: {phaseName}
          </div>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr>
                <th className={cn(TH_CLASS, 'text-right')}>משימה</th>
                <th className={cn(TH_CLASS, 'w-[130px] text-center')}>משך (עריכה)</th>
                <th className={cn(TH_CLASS, 'w-[90px] text-center')}>סיום מתוכנן</th>
                <th className={cn(TH_CLASS, 'w-20 text-center')}>סיום שלב</th>
                <th className={cn(TH_CLASS, 'w-[70px] text-center')}>חריגה</th>
                <th className={cn(TH_CLASS, 'text-center')}>הסר תלות</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a: any) => (
                <React.Fragment key={a.taskId}>
                  <tr className={cn('bg-card', !rowErrors[a.taskId] && 'border-b border-muted')}>
                    <td className="px-2.5 py-2 font-medium text-foreground">
                      {a.taskTitle}
                      {a.assignedUserName && <span className="block text-[13px] text-subtle-foreground">👤 {a.assignedUserName}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="text"
                          value={editDur[a.taskId] !== undefined ? editDur[a.taskId] : (a.duration ?? '')}
                          onChange={e => setEditDur(p => ({ ...p, [a.taskId]: e.target.value }))}
                          placeholder="30ד / 1ש30ד"
                          className="w-[72px] rounded-[5px] border border-border px-1.5 py-1 text-center text-sm [direction:ltr]"
                        />
                        <button
                          onClick={() => saveDuration(a.taskId, a.duration)}
                          disabled={saving === a.taskId}
                          className={cn(
                            'whitespace-nowrap rounded-[5px] border-none px-2 py-1 text-[13px] text-white',
                            saving === a.taskId ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-primary'
                          )}
                        >
                          {saving === a.taskId ? '...' : 'עדכן'}
                        </button>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-center font-semibold text-danger [direction:ltr]">
                      {formatTime(a.taskEnd)}
                    </td>
                    <td className="px-2.5 py-2 text-center text-muted-foreground [direction:ltr]">
                      {formatTime(a.phaseEnd)}
                    </td>
                    <td className="px-2.5 py-2 text-center font-bold text-danger">
                      +{a.overrunMins}ד'
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {(a.dependencies ?? []).length === 0 ? (
                        <span className="text-[13px] text-subtle-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-[3px]">
                          {(a.dependencies ?? []).map((dep: any) => {
                            const key = `${a.taskId}|${dep.taskId}`;
                            return (
                              <button
                                key={dep.taskId}
                                onClick={() => removeDep(a.taskId, dep.taskId, dep.taskTitle)}
                                disabled={removing === key}
                                title={`הסר תלות על: ${dep.taskTitle}`}
                                className={cn(
                                  'max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap rounded border border-danger px-[7px] py-[3px] text-[13px] text-danger',
                                  removing === key ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-danger-bg'
                                )}
                              >
                                {removing === key ? '...' : `🔗 ${dep.taskTitle.length > 18 ? dep.taskTitle.slice(0, 18) + '…' : dep.taskTitle}`}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                  {rowErrors[a.taskId] && (
                    <tr>
                      <td colSpan={6} className="border-b border-muted px-2.5 pb-2 pt-0.5">
                        <span className="text-[13px] text-danger">⚠️ {rowErrors[a.taskId]}</span>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="mt-2 text-sm text-subtle-foreground">
        לאחר עדכון משך או הסרת תלות — הפעל מחדש את "בדוק חריגות" כדי לאמת.
      </p>
    </div>
  );
}

function Step5Content({ sortResult, version }: { sortResult: { reordered: number } | null; version: any }) {
  // Build a simple preview of tasks with plannedStart per sub-phase
  const sortedPhases = [...(version.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
  const sample: { phaseName: string; subName: string; tasks: any[] }[] = [];

  for (const phase of sortedPhases) {
    for (const sub of phase.subPhases ?? []) {
      const tasksWithTime = (sub.tasks ?? []).filter((t: any) => t.plannedStart);
      if (tasksWithTime.length < 2) continue;
      const sorted = [...tasksWithTime].sort((a: any, b: any) =>
        new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
      );
      const current = [...tasksWithTime].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      const needsSort = sorted.some((t: any, i: number) => t.id !== current[i]?.id);
      if (needsSort) {
        sample.push({ phaseName: phase.name, subName: sub.name, tasks: sorted });
      }
      if (sample.length >= 3) break;
    }
    if (sample.length >= 3) break;
  }

  return (
    <div>
      <h3 className="m-0 mb-2 text-[17px] text-foreground">🔀 מיון כרונולוגי</h3>
      <p className="m-0 mb-4 text-[15px] text-subtle-foreground">
        מסדר את orderIndex של משימות לפי plannedStart בתוך כל תת-שלב.
      </p>

      {sortResult ? (
        <div className="p-[30px] text-center">
          <div className="mb-3 text-[40px]">✅</div>
          <div className="text-[17px] font-bold text-success">
            {sortResult.reordered > 0 ? `${sortResult.reordered} משימות מוינו מחדש` : 'הסדר כבר תקין — אין שינויים נדרשים'}
          </div>
        </div>
      ) : sample.length === 0 ? (
        <div className="p-[30px] text-center text-subtle-foreground">
          <div className="mb-2 text-[32px]">ℹ️</div>
          אין משימות עם זמנים מתוכננים הדורשות מיון
        </div>
      ) : (
        <div>
          <div className="mb-3 text-[15px] font-semibold text-foreground">תצוגה מקדימה — תת-שלבים שישתנו:</div>
          {sample.map((s, i) => (
            <div key={i} className="mb-4 overflow-hidden rounded-md border border-border">
              <div className="bg-muted px-3.5 py-2 text-[15px] font-semibold text-foreground">
                {s.phaseName} › {s.subName}
              </div>
              <div className="px-3.5 py-2.5">
                {s.tasks.map((t: any, ti: number) => (
                  <div key={t.id} className="flex items-center gap-2.5 py-1 text-[15px] text-muted-foreground">
                    <span className="min-w-[20px] text-subtle-foreground">{ti + 1}.</span>
                    <span className="min-w-[50px] font-mono text-info [direction:ltr]">
                      {formatTime(t.plannedStart)}
                    </span>
                    <span>{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Wizard component ──────────────────────────────────────────────────

export function PlanWizard({ version, token, users, teams, onClose, onRefresh }: PlanWizardProps) {
  const headers = { Authorization: `Bearer ${token}` };
  // Scheduling during REHEARSAL writes to the task's rehearsal-specific planned times,
  // never the production plannedStart/End — keeps the two schedules independent.
  const rescheduleTarget = version.status === 'REHEARSAL' ? 'rehearsal' : 'production';

  const initWizState = (): WizardState => {
    const saved = version.wizardState as WizardState | null;
    return saved ?? { step1: null, step2: null, step3: null, step4: null, step5: null };
  };

  const initStep = (): number => {
    const saved = version.wizardState as WizardState | null;
    if (!saved) return 0;
    const keys: (keyof WizardState)[] = ['step1', 'step2', 'step3', 'step4', 'step5'];
    const first = keys.findIndex(k => saved[k] === null);
    return first === -1 ? 4 : first;
  };

  const [wizState, setWizState] = useState<WizardState>(initWizState);
  const [step, setStep] = useState<number>(initStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepMessage, setStepMessage] = useState<string | null>(null);

  const { starts: initStarts, ends: initEnds } = initPhaseTimes(version);
  const [phaseStarts, setPhaseStarts] = useState<Record<string, string>>(initStarts);
  const [phaseEnds, setPhaseEnds] = useState<Record<string, string>>(initEnds);

  const [workerReplacements, setWorkerReplacements] = useState<Record<string, { toUserId: string; phaseId: string }[]>>({});
  const [depsResult, setDepsResult] = useState<{ created: number; skipped: number } | null>(null);
  const [anomalies, setAnomalies] = useState<any[] | null>(null);
  const [sortResult, setSortResult] = useState<{ reordered: number } | null>(null);

  const saveWizState = useCallback(async (newState: WizardState) => {
    setWizState(newState);
    try {
      await axios.patch(`${API}/versions/${version.id}/wizard-state`, { state: newState }, { headers });
    } catch {
      // non-critical — state stored locally
    }
  }, [version.id]); // eslint-disable-line

  const markStep = async (status: 'done' | 'skipped') => {
    const key = `step${step + 1}` as keyof WizardState;
    const newState = { ...wizState, [key]: status };
    await saveWizState(newState);
    setError(null);
    setStepMessage(null);
    if (step < 4) setStep(s => s + 1);
  };

  const buildPhasesFromInputs = () =>
    Object.entries(phaseStarts)
      .filter(([, v]) => v)
      .map(([phaseId, startStr]) => ({
        phaseId,
        startTime: toUtcIso(startStr) as string,
        ...(phaseEnds[phaseId] ? { endTime: toUtcIso(phaseEnds[phaseId]) as string } : {}),
      }));

  const buildPhasesFromVersion = () =>
    (version.phases ?? [])
      .filter((p: any) => p.plannedStart)
      .map((p: any) => ({
        phaseId: p.id,
        startTime: p.plannedStart as string,
        ...(p.plannedEnd ? { endTime: p.plannedEnd as string } : {}),
      }));

  // ── Step actions ──────────────────────────────────────────────────────────

  const executeStep1 = async () => {
    setLoading(true);
    setError(null);
    try {
      const phases = buildPhasesFromInputs();
      if (phases.length === 0) { setError('יש להגדיר שעת התחלה לפחות לשלב אחד'); return; }
      const res = await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases, target: rescheduleTarget }, { headers });
      setStepMessage(`✅ תזמון עודכן — ${res.data.updated ?? 0} משימות`);
      onRefresh();
      await markStep('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה בתזמון');
    } finally {
      setLoading(false);
    }
  };

  const executeStep2 = async () => {
    const entries = Object.entries(workerReplacements)
      .flatMap(([fromKey, replacements]) => replacements.filter(r => r.toUserId).map(r => [fromKey, r] as const));
    if (entries.length === 0) { await markStep('done'); return; }
    setLoading(true);
    setError(null);
    try {
      for (const [fromKey, { toUserId, phaseId }] of entries) {
        const phaseBody = phaseId ? { phaseId } : {};
        if (fromKey.startsWith('__empty__:')) {
          const fromTeamId = fromKey.slice(10);
          await axios.patch(`${API}/versions/${version.id}/reassign-tasks`, { fromUserName: null, toUserId, fromTeamId, ...phaseBody }, { headers });
        } else {
          await axios.patch(`${API}/versions/${version.id}/reassign-tasks`, { fromUserName: fromKey, toUserId, ...phaseBody }, { headers });
        }
      }
      setStepMessage(`✅ ${entries.length} עובדים הוחלפו`);
      onRefresh();
      await markStep('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה בהחלפת עובדים');
    } finally {
      setLoading(false);
    }
  };

  const executeStep3Full = async () => {
    setLoading(true);
    setError(null);
    try {
      const dRes = await axios.post(`${API}/versions/${version.id}/auto-deps-by-user`, {}, { headers });
      setDepsResult({ created: dRes.data.created, skipped: dRes.data.skipped });
      const phases = buildPhasesFromVersion();
      if (phases.length > 0) {
        await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases, respectDeps: true, target: rescheduleTarget }, { headers });
      }
      setStepMessage(`✅ ${dRes.data.created} תלויות נוצרו, זמנים עודכנו`);
      onRefresh();
      await markStep('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה ביצירת תלויות');
    } finally {
      setLoading(false);
    }
  };

  const executeStep3CalcOnly = async () => {
    setLoading(true);
    setError(null);
    try {
      const phases = buildPhasesFromVersion();
      if (phases.length === 0) { setError('אין שלבים מתוזמנים — בצע שלב 1 קודם'); return; }
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases, respectDeps: true, target: rescheduleTarget }, { headers });
      setStepMessage('✅ זמנים חושבו מחדש לפי תלויות קיימות');
      onRefresh();
      await markStep('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה בחישוב זמנים');
    } finally {
      setLoading(false);
    }
  };

  const executeStep4 = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/versions/${version.id}/detect-anomalies`, { headers });
      setAnomalies(res.data.anomalies);
      if (res.data.count === 0) {
        setStepMessage('✅ לא נמצאו חריגות');
        await markStep('done');
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה בבדיקת חריגות');
    } finally {
      setLoading(false);
    }
  };

  const executeStep5 = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/versions/${version.id}/sort-by-planned-start`, {}, { headers });
      setSortResult({ reordered: res.data.reordered });
      setStepMessage(`✅ ${res.data.reordered} משימות מוינו לפי שעת התחלה`);
      onRefresh();
      await markStep('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'שגיאה במיון');
    } finally {
      setLoading(false);
    }
  };

  // ── Progress bar ───────────────────────────────────────────────────────────

  const stepKeys: (keyof WizardState)[] = ['step1', 'step2', 'step3', 'step4', 'step5'];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[3000]" dir="rtl">
      <div className="absolute inset-0 backdrop-blur-[2px]" style={{ background: C.bgOverlay }} />

      <div className="relative z-[1] mx-auto flex max-w-[860px] flex-col overflow-hidden rounded-2xl bg-card shadow-md" style={{ margin: '32px auto', maxHeight: 'calc(100vh - 64px)' }}>

        {/* ── Header — light, matches the app's other modal headers ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <div className="text-[17px] font-bold text-foreground">🔧 הכן תוכנית</div>
            <div className="mt-0.5 text-sm text-subtle-foreground">{version.name}</div>
          </div>
          <button
            onClick={onClose}
            title="סגור"
            className="cursor-pointer border-none bg-transparent p-1 text-lg leading-none text-subtle-foreground transition-colors duration-fast ease-out hover:text-danger"
          >
            ✕
          </button>
        </div>

        {/* ── Progress bar — connected step chain, consistent with the app's other stage-chain components ── */}
        <div className="shrink-0 border-b border-border bg-muted px-6 py-4">
          <div className="flex items-stretch gap-1">
            {STEP_LABELS.map((label, i) => {
              const key = stepKeys[i];
              const status = wizState[key];
              const isActive = step === i;
              const isDone = status === 'done';
              const isSkipped = status === 'skipped';
              const bg = isActive ? C.brandDim : isDone ? C.successBg : isSkipped ? C.bgHover : C.bgCard;
              const fg = isActive ? C.brand : isDone ? C.success : isSkipped ? C.textMuted : C.textSecondary;
              const border = isActive ? C.brand : isDone ? C.success : C.border;
              return (
                <React.Fragment key={i}>
                  <button
                    onClick={() => { setStep(i); setError(null); setStepMessage(null); }}
                    className={cn(
                      'flex-1 rounded-md border-[1.5px] px-1.5 py-2 text-[13px] leading-snug cursor-pointer transition-[background-color,color,border-color] duration-fast ease-out',
                      isActive ? 'font-bold' : 'font-medium'
                    )}
                    style={{ background: bg, color: fg, borderColor: border }}
                  >
                    <div className="mb-[3px] text-[15px]">
                      {isDone ? '✅' : isSkipped ? '⊘' : `${i + 1}`}
                    </div>
                    {label}
                  </button>
                  {i < 4 && (
                    <div className="h-0.5 w-3.5 shrink-0 self-center border-t-2 border-dashed" style={{ borderTopColor: isDone ? C.success : C.border }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Step content ── */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {error && (
            <div className="mb-4 rounded-lg border border-danger bg-danger-bg px-4 py-3 text-[15px] text-danger">
              ⚠️ {error}
            </div>
          )}
          {stepMessage && (
            <div className="mb-4 rounded-lg border border-success bg-success-bg px-4 py-3 text-[15px] text-success">
              {stepMessage}
            </div>
          )}

          {step === 0 && (
            <Step1Content
              version={version}
              phaseStarts={phaseStarts}
              phaseEnds={phaseEnds}
              setPhaseStarts={setPhaseStarts}
              setPhaseEnds={setPhaseEnds}
            />
          )}
          {step === 1 && (
            <Step2Content
              version={version}
              users={users}
              teams={teams}
              workerReplacements={workerReplacements}
              setWorkerReplacements={setWorkerReplacements}
            />
          )}
          {step === 2 && <Step3Content depsResult={depsResult} />}
          {step === 3 && <Step4Content anomalies={anomalies} versionId={version.id} token={token} onRedetect={executeStep4} />}
          {step === 4 && <Step5Content sortResult={sortResult} version={version} />}
        </div>

        {/* ── Footer — one clear primary action; back/skip de-emphasized so they
             don't compete with it. The old footer also had a "close without
             saving" button that called the exact same onClose as the header's
             ✕ — pure duplication with a misleading label implying different
             behavior. Removed; the header ✕ is now the only close action. ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-card px-6 py-3">
          <button
            onClick={() => { setStep(s => Math.max(0, s - 1)); setError(null); setStepMessage(null); }}
            disabled={step === 0}
            className={cn(
              'rounded-md border bg-transparent px-[18px] py-[9px] text-[15px] transition-colors duration-fast ease-out',
              step === 0 ? 'cursor-not-allowed text-subtle-foreground' : 'cursor-pointer text-muted-foreground'
            )}
            style={{ borderColor: step === 0 ? C.border : C.borderEm }}
          >
            → חזור
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => markStep('skipped')}
              disabled={loading}
              className={cn(
                'border-none bg-transparent px-2.5 py-[9px] text-sm text-subtle-foreground underline underline-offset-2',
                loading ? 'cursor-not-allowed' : 'cursor-pointer'
              )}
            >
              דלג על שלב זה
            </button>

            {step === 0 && (
              <button onClick={executeStep1} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.brand)}>
                {loading ? '...' : '📅 קבע מסגרת ותזמן'}
              </button>
            )}
            {step === 1 && (
              <button onClick={executeStep2} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.warning)}>
                {loading ? '...' : '🔄 החלף עובדים'}
              </button>
            )}
            {step === 2 && (
              <>
                <button onClick={executeStep3CalcOnly} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.textSecondary)}>
                  {loading ? '...' : '⏱ רק חשב זמנים'}
                </button>
                <button onClick={executeStep3Full} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.brand)}>
                  {loading ? '...' : '🔗 צור תלויות וחשב'}
                </button>
              </>
            )}
            {step === 3 && anomalies === null && (
              <button onClick={executeStep4} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.brand)}>
                {loading ? '...' : '🔍 בדוק חריגות'}
              </button>
            )}
            {step === 3 && anomalies !== null && anomalies.length > 0 && (
              <button onClick={() => markStep('done')} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.warning)}>
                המשך בכל זאת ←
              </button>
            )}
            {step === 4 && (
              <button onClick={executeStep5} disabled={loading} className={PRIMARY_BTN_CLASS} style={btnStyle(C.brand)}>
                {loading ? '...' : '🔀 סדר לפי שעה'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PRIMARY_BTN_CLASS = 'rounded-md border-none px-5 py-[9px] text-[15px] font-bold text-white shadow-xs cursor-pointer transition-[background-color] duration-fast ease-out';

function btnStyle(bg: string): React.CSSProperties {
  return { background: bg };
}
