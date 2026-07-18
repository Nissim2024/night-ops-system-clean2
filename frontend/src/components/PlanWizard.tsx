import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { DateField, DateTimeField } from './DatePicker';
import { C, FONT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';

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
      <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>📅 הגדרת מסגרת זמן</h3>
      <p style={{ margin: '0 0 16px', color: C.textMuted, fontSize: '15px' }}>
        קבע שעת התחלה וסיום לכל שלב. המערכת תחשב את זמן כל משימה לפי מבנה התלויות.
      </p>

      {/* Base night date picker */}
      <div style={{ marginBottom: '18px', padding: '12px 16px', background: C.infoBg, border: `1px solid ${C.info}`, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '600', fontSize: '15px', color: C.info, whiteSpace: 'nowrap' }}>🌙 תאריך לילה ההטמעה:</span>
        <DateField
          value={baseDate}
          onChange={v => setBaseDate(v)}
          style={{ padding: '6px 10px', border: `1px solid ${C.info}`, borderRadius: '6px', fontSize: '15px', background: 'white', color: C.textPrimary }}
        />
        <button
          onClick={() => applyDefaults(baseDate)}
          disabled={!baseDate}
          style={{ padding: '6px 14px', background: baseDate ? C.info : C.textMuted, color: 'white', border: 'none', borderRadius: '6px', cursor: baseDate ? 'pointer' : 'not-allowed', fontSize: '15px', fontWeight: '600', whiteSpace: 'nowrap' }}
        >
          חשב ברירות מחדל ⚡
        </button>
        <span style={{ fontSize: '13px', color: C.textMuted }}>כל שעות השלבים יחושבו אוטומטית</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
        <thead>
          <tr style={{ background: C.bgNested }}>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>שלב</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>התחלה</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>סיום</th>
          </tr>
        </thead>
        <tbody>
          {sortedPhases.map((phase: any) => (
            <tr key={phase.id} style={{ borderBottom: `1px solid ${C.bgNested}` }}>
              <td style={{ padding: '10px 12px', color: C.textPrimary, fontWeight: '500' }}>{phase.name}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                <DateTimeField
                  value={phaseStarts[phase.id] ?? ''}
                  onChange={v => setPhaseStarts({ ...phaseStarts, [phase.id]: v })}
                  style={{ padding: '6px 10px', border: `1px solid ${C.borderEm}`, borderRadius: '6px', fontSize: '15px' }}
                />
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
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
      <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>👤</div>
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
      <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>👥 החלפת עובדים</h3>
      <p style={{ margin: '0 0 20px', color: C.textMuted, fontSize: '15px' }}>
        בחר מחליף לכל עובד מהתבנית. עזוב ריק כדי לשמור על העובד המקורי. ניתן להגביל את ההחלפה לשלב מסוים בלבד, במקום כל הגרסה —
        וניתן להוסיף כמה החלפות לאותו עובד, כל אחת עבור שלב אחר.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
        <thead>
          <tr style={{ background: C.bgNested }}>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>עובד בתבנית</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>מחליף →</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: `2px solid ${C.border}`, fontWeight: '600', color: C.textPrimary }}>תחולה</th>
            <th style={{ padding: '10px 12px', borderBottom: `2px solid ${C.border}`, width: '32px' }} />
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
              <tr key={`${entry.key}:${idx}`} style={{ borderBottom: idx === rows.length - 1 ? `1px solid ${C.bgNested}` : 'none', background: entry.isEmpty ? C.warningBg : 'transparent' }}>
                <td style={{ padding: '10px 12px', color: entry.isEmpty ? C.warning : C.textPrimary }}>
                  {idx === 0 && (
                    <>
                      {entry.isEmpty ? (
                        <span>
                          <span style={{ color: C.warning, marginLeft: '4px' }}>⚠</span>
                          לא משובץ
                        </span>
                      ) : (
                        <span>
                          {entry.displayName}
                          {entry.isUnknown && (
                            <span style={{ fontSize: '13px', color: C.danger, marginRight: '6px' }} title="עובד לא פעיל / לא קיים במערכת">⚠ לא פעיל</span>
                          )}
                        </span>
                      )}
                      {team && (
                        <span style={{ fontSize: '13px', color: C.textMuted, marginRight: '6px' }}>({team.name})</span>
                      )}
                    </>
                  )}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <select
                    value={current.toUserId}
                    onChange={e => updateRow(entry.key, idx, { toUserId: e.target.value })}
                    style={{ padding: '7px 10px', border: `1px solid ${C.borderEm}`, borderRadius: '6px', fontSize: '15px', width: '100%', background: 'white' }}
                  >
                    <option value="">{entry.isEmpty ? '— בחר עובד לשיבוץ —' : '— ללא שינוי —'}</option>
                    {pool.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <select
                    value={current.phaseId}
                    disabled={!current.toUserId}
                    onChange={e => updateRow(entry.key, idx, { phaseId: e.target.value })}
                    style={{ padding: '7px 10px', border: `1px solid ${C.borderEm}`, borderRadius: '6px', fontSize: '15px', width: '100%', background: current.toUserId ? 'white' : C.bgNested, color: current.toUserId ? C.textPrimary : C.textMuted }}
                    title="ברירת מחדל: כל הגרסה"
                  >
                    <option value="">כל הגרסה</option>
                    {sortedPhases.map((p: any) => (
                      <option key={p.id} value={p.id} disabled={usedPhaseIds(idx).has(p.id)}>רק שלב: {p.name}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  {idx === rows.length - 1 ? (
                    <button
                      type="button"
                      title="הוסף החלפה נוספת לאותו עובד עבור שלב אחר"
                      onClick={() => addRow(entry.key)}
                      style={{ background: 'none', border: `1px solid ${C.borderEm}`, borderRadius: '6px', width: '26px', height: '26px', cursor: 'pointer', color: C.info, fontSize: '15px', lineHeight: 1 }}
                    >+</button>
                  ) : (
                    <button
                      type="button"
                      title="הסר החלפה זו"
                      onClick={() => removeRow(entry.key, idx)}
                      style={{ background: 'none', border: `1px solid ${C.borderEm}`, borderRadius: '6px', width: '26px', height: '26px', cursor: 'pointer', color: C.danger, fontSize: '15px', lineHeight: 1 }}
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
      <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>🔗 תלויות ועדכון זמנים</h3>
      <p style={{ margin: '0 0 16px', color: C.textMuted, fontSize: '15px' }}>
        יצירת תלויות אוטומטיות בין משימות של אותו עובד (לפי סדר), ואחריה חישוב זמני ביצוע לפי שרשראות התלות.
      </p>

      <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ fontWeight: 'bold', color: C.textPrimary, marginBottom: '8px', fontSize: '15px' }}>מה יקרה:</div>
        <ul style={{ margin: 0, paddingRight: '20px', color: C.textSecondary, fontSize: '15px', lineHeight: '1.8' }}>
          <li>לכל עובד, כל משימה שלו תהיה תלויה במשימה הקודמת שלו (בתוך אותו שלב)</li>
          <li>תלויות קיימות לא יידרסו</li>
          <li>לאחר יצירת התלויות — המערכת תחשב מחדש את זמני כל המשימות</li>
        </ul>
      </div>

      <div style={{ background: C.warningBg, border: `1px solid ${C.warning}`, borderRadius: '10px', padding: '12px 16px', fontSize: '15px', color: C.warning }}>
        💡 <strong>לחץ "רק חשב זמנים"</strong> אם כבר יצרת תלויות ורוצה רק לעדכן את הזמנים לפיהן.
      </div>

      {depsResult && (
        <div style={{ marginTop: '16px', background: C.successBg, border: `1px solid ${C.success}`, borderRadius: '8px', padding: '12px 16px', fontSize: '15px', color: C.success }}>
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

  const thStyle: React.CSSProperties = {
    padding: '9px 10px', textAlign: 'right', borderBottom: `2px solid ${C.borderEm}`,
    color: C.textPrimary, fontWeight: '700', fontSize: '14px', background: C.border,
  };
  const thC: React.CSSProperties = { ...thStyle, textAlign: 'center' };

  if (anomalies === null) {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>🔍 בדיקת חריגות</h3>
        <p style={{ margin: '0 0 20px', color: C.textMuted, fontSize: '15px' }}>
          בדיקה אם משימות כלשהן חורגות מסיום השלב המתוכנן.
        </p>
        <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
          לחץ "בדוק חריגות" כדי לבצע את הבדיקה
        </div>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>🔍 בדיקת חריגות</h3>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
          <div style={{ color: C.success, fontWeight: 'bold', fontSize: '17px' }}>לא נמצאו חריגות</div>
          <div style={{ color: C.textMuted, fontSize: '15px', marginTop: '8px' }}>כל המשימות בתוך מסגרת הזמן של השלב</div>
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
      <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>🔍 בדיקת חריגות</h3>
      <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: C.danger, fontSize: '15px', fontWeight: 'bold' }}>
        ⚠️ נמצאו {anomalies.length} חריגות — משימות שיסתיימו אחרי סיום השלב
      </div>

      {Object.entries(byPhase).map(([phaseName, items]) => (
        <div key={phaseName} style={{ marginBottom: '20px' }}>
          <div style={{ fontWeight: 'bold', color: C.textPrimary, marginBottom: '8px', fontSize: '15px', padding: '6px 12px', background: C.dangerBg, borderRadius: '6px', borderRight: `3px solid ${C.danger}` }}>
            שלב: {phaseName}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
            <thead>
              <tr>
                <th style={thStyle}>משימה</th>
                <th style={{ ...thC, width: '130px' }}>משך (עריכה)</th>
                <th style={{ ...thC, width: '90px' }}>סיום מתוכנן</th>
                <th style={{ ...thC, width: '80px' }}>סיום שלב</th>
                <th style={{ ...thC, width: '70px' }}>חריגה</th>
                <th style={{ ...thC }}>הסר תלות</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a: any) => (
                <React.Fragment key={a.taskId}>
                  <tr style={{ borderBottom: rowErrors[a.taskId] ? 'none' : `1px solid ${C.bgNested}`, background: 'white' }}>
                    <td style={{ padding: '8px 10px', color: C.textPrimary, fontWeight: '500' }}>
                      {a.taskTitle}
                      {a.assignedUserName && <span style={{ display: 'block', fontSize: '13px', color: C.textMuted }}>👤 {a.assignedUserName}</span>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="text"
                          value={editDur[a.taskId] !== undefined ? editDur[a.taskId] : (a.duration ?? '')}
                          onChange={e => setEditDur(p => ({ ...p, [a.taskId]: e.target.value }))}
                          placeholder="30ד / 1ש30ד"
                          style={{ width: '72px', padding: '4px 6px', border: `1px solid ${C.borderEm}`, borderRadius: '5px', fontSize: '14px', direction: 'ltr', textAlign: 'center' }}
                        />
                        <button
                          onClick={() => saveDuration(a.taskId, a.duration)}
                          disabled={saving === a.taskId}
                          style={{ padding: '4px 8px', background: saving === a.taskId ? C.textMuted : C.brand, color: 'white', border: 'none', borderRadius: '5px', cursor: saving === a.taskId ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
                        >
                          {saving === a.taskId ? '...' : 'עדכן'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: C.danger, direction: 'ltr', fontWeight: '600' }}>
                      {new Date(a.taskEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: C.textSecondary, direction: 'ltr' }}>
                      {new Date(a.phaseEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: C.danger, fontWeight: 'bold' }}>
                      +{a.overrunMins}ד'
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {(a.dependencies ?? []).length === 0 ? (
                        <span style={{ color: C.textMuted, fontSize: '13px' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {(a.dependencies ?? []).map((dep: any) => {
                            const key = `${a.taskId}|${dep.taskId}`;
                            return (
                              <button
                                key={dep.taskId}
                                onClick={() => removeDep(a.taskId, dep.taskId, dep.taskTitle)}
                                disabled={removing === key}
                                title={`הסר תלות על: ${dep.taskTitle}`}
                                style={{ padding: '3px 7px', background: removing === key ? C.textMuted : C.dangerBg, color: C.danger, border: `1px solid ${C.danger}`, borderRadius: '4px', cursor: removing === key ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}
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
                      <td colSpan={6} style={{ padding: '2px 10px 8px', borderBottom: `1px solid ${C.bgNested}` }}>
                        <span style={{ color: C.danger, fontSize: '13px' }}>⚠️ {rowErrors[a.taskId]}</span>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ color: C.textMuted, fontSize: '14px', marginTop: '8px' }}>
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
      <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: C.textPrimary }}>🔀 מיון כרונולוגי</h3>
      <p style={{ margin: '0 0 16px', color: C.textMuted, fontSize: '15px' }}>
        מסדר את orderIndex של משימות לפי plannedStart בתוך כל תת-שלב.
      </p>

      {sortResult ? (
        <div style={{ textAlign: 'center', padding: '30px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
          <div style={{ color: C.success, fontWeight: 'bold', fontSize: '17px' }}>
            {sortResult.reordered > 0 ? `${sortResult.reordered} משימות מוינו מחדש` : 'הסדר כבר תקין — אין שינויים נדרשים'}
          </div>
        </div>
      ) : sample.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>ℹ️</div>
          אין משימות עם זמנים מתוכננים הדורשות מיון
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: '600', color: C.textPrimary, marginBottom: '12px', fontSize: '15px' }}>תצוגה מקדימה — תת-שלבים שישתנו:</div>
          {sample.map((s, i) => (
            <div key={i} style={{ marginBottom: '16px', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: C.bgNested, fontWeight: '600', fontSize: '15px', color: C.textPrimary }}>
                {s.phaseName} › {s.subName}
              </div>
              <div style={{ padding: '10px 14px' }}>
                {s.tasks.map((t: any, ti: number) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', fontSize: '15px', color: C.textSecondary }}>
                    <span style={{ color: C.textMuted, minWidth: '20px' }}>{ti + 1}.</span>
                    <span style={{ color: C.info, minWidth: '50px', direction: 'ltr', fontFamily: 'monospace' }}>
                      {new Date(t.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, direction: 'rtl' }}>
      <div style={{ position: 'absolute', inset: 0, background: C.bgOverlay, backdropFilter: 'blur(2px)' }} />

      <div style={{
        position: 'relative', zIndex: 1, maxWidth: 860,
        margin: '32px auto', background: C.bgCard, borderRadius: RADIUS.xl,
        boxShadow: SHADOW.md, overflow: 'hidden', fontFamily: FONT,
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 64px)',
      }}>

        {/* ── Header — light, matches the app's other modal headers ── */}
        <div style={{ padding: `${SP[4]} ${SP[6]}`, background: C.bgCard, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔧 הכן תוכנית</div>
            <div style={{ fontSize: '14px', color: C.textMuted, marginTop: '2px' }}>{version.name}</div>
          </div>
          <button
            onClick={onClose}
            title="סגור"
            style={{ background: 'transparent', border: 'none', color: C.textMuted, fontSize: '18px', cursor: 'pointer', padding: SP[1], lineHeight: 1, transition: EASE.fast }}
            onMouseEnter={e => { e.currentTarget.style.color = C.danger; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
          >
            ✕
          </button>
        </div>

        {/* ── Progress bar — connected step chain, consistent with the app's other stage-chain components ── */}
        <div style={{ padding: `${SP[4]} ${SP[6]}`, background: C.bgNested, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: SP[1], alignItems: 'stretch' }}>
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
                    style={{ flex: 1, padding: '8px 6px', border: `1.5px solid ${border}`, borderRadius: RADIUS.md, cursor: 'pointer', background: bg, color: fg, fontSize: '13px', fontWeight: isActive ? WEIGHT.bold : WEIGHT.medium, transition: EASE.fast, lineHeight: 1.4, fontFamily: FONT }}
                  >
                    <div style={{ fontSize: '15px', marginBottom: '3px' }}>
                      {isDone ? '✅' : isSkipped ? '⊘' : `${i + 1}`}
                    </div>
                    {label}
                  </button>
                  {i < 4 && (
                    <div style={{ width: '14px', alignSelf: 'center', height: '2px', borderTop: `2px dashed ${isDone ? C.success : C.border}`, flexShrink: 0 }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Step content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {error && (
            <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: C.danger, fontSize: '15px' }}>
              ⚠️ {error}
            </div>
          )}
          {stepMessage && (
            <div style={{ background: C.successBg, border: `1px solid ${C.success}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: C.success, fontSize: '15px' }}>
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
        <div style={{ padding: `${SP[3]} ${SP[6]}`, borderTop: `1px solid ${C.border}`, background: C.bgCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={() => { setStep(s => Math.max(0, s - 1)); setError(null); setStepMessage(null); }}
            disabled={step === 0}
            style={{
              padding: '9px 18px', background: 'transparent',
              border: `1px solid ${step === 0 ? C.border : C.borderEm}`, borderRadius: RADIUS.md,
              cursor: step === 0 ? 'not-allowed' : 'pointer', color: step === 0 ? C.textDisabled : C.textSecondary,
              fontSize: '15px', fontFamily: FONT, transition: EASE.fast,
            }}
          >
            → חזור
          </button>

          <div style={{ display: 'flex', gap: SP[3], alignItems: 'center' }}>
            <button
              onClick={() => markStep('skipped')}
              disabled={loading}
              style={{ padding: '9px 10px', background: 'transparent', color: C.textMuted, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px', fontFamily: FONT, textDecoration: 'underline', textUnderlineOffset: '2px' }}
            >
              דלג על שלב זה
            </button>

            {step === 0 && (
              <button onClick={executeStep1} disabled={loading} style={btnStyle(C.brand)}>
                {loading ? '...' : '📅 קבע מסגרת ותזמן'}
              </button>
            )}
            {step === 1 && (
              <button onClick={executeStep2} disabled={loading} style={btnStyle(C.warning)}>
                {loading ? '...' : '🔄 החלף עובדים'}
              </button>
            )}
            {step === 2 && (
              <>
                <button onClick={executeStep3CalcOnly} disabled={loading} style={btnStyle(C.textSecondary)}>
                  {loading ? '...' : '⏱ רק חשב זמנים'}
                </button>
                <button onClick={executeStep3Full} disabled={loading} style={btnStyle(C.brand)}>
                  {loading ? '...' : '🔗 צור תלויות וחשב'}
                </button>
              </>
            )}
            {step === 3 && anomalies === null && (
              <button onClick={executeStep4} disabled={loading} style={btnStyle(C.brand)}>
                {loading ? '...' : '🔍 בדוק חריגות'}
              </button>
            )}
            {step === 3 && anomalies !== null && anomalies.length > 0 && (
              <button onClick={() => markStep('done')} disabled={loading} style={btnStyle(C.warning)}>
                המשך בכל זאת ←
              </button>
            )}
            {step === 4 && (
              <button onClick={executeStep5} disabled={loading} style={btnStyle(C.brand)}>
                {loading ? '...' : '🔀 סדר לפי שעה'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '9px 20px', background: bg, color: 'white',
    border: 'none', borderRadius: RADIUS.md, cursor: 'pointer',
    fontSize: '15px', fontWeight: WEIGHT.bold, fontFamily: FONT,
    boxShadow: SHADOW.xs, transition: EASE.fast,
  };
}
