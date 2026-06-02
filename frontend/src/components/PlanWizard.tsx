import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

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

function getUniqueWorkers(version: any): string[] {
  const names = new Set<string>();
  for (const phase of version.phases ?? []) {
    for (const sub of phase.subPhases ?? []) {
      for (const task of sub.tasks ?? []) {
        if (task.assignedUserName) names.add(task.assignedUserName.trim());
      }
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'he'));
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
  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>📅 הגדרת מסגרת זמן</h3>
      <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
        קבע שעת התחלה וסיום לכל שלב. המערכת תחשב את זמן כל משימה לפי מבנה התלויות.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '600', color: '#1a2332' }}>שלב</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: '600', color: '#1a2332' }}>התחלה</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: '600', color: '#1a2332' }}>סיום</th>
          </tr>
        </thead>
        <tbody>
          {sortedPhases.map((phase: any) => (
            <tr key={phase.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 12px', color: '#1a2332', fontWeight: '500' }}>{phase.name}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                <input
                  type="datetime-local"
                  value={phaseStarts[phase.id] ?? ''}
                  onChange={e => setPhaseStarts({ ...phaseStarts, [phase.id]: e.target.value })}
                  style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', direction: 'ltr' }}
                />
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                <input
                  type="datetime-local"
                  value={phaseEnds[phase.id] ?? ''}
                  onChange={e => setPhaseEnds({ ...phaseEnds, [phase.id]: e.target.value })}
                  style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', direction: 'ltr' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step2Content({ version, users, workerReplacements, setWorkerReplacements }: {
  version: any;
  users: { id: string; fullName: string }[];
  workerReplacements: Record<string, string>;
  setWorkerReplacements: (v: Record<string, string>) => void;
}) {
  const workers = getUniqueWorkers(version);

  if (workers.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>👤</div>
        אין משימות עם עובדים מוקצים בתוכנית זו
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>👥 החלפת עובדים</h3>
      <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
        בחר מחליף לכל עובד מהתבנית. עזוב ריק כדי לשמור על העובד המקורי.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '600', color: '#1a2332' }}>עובד בתבנית</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '600', color: '#1a2332' }}>מחליף →</th>
          </tr>
        </thead>
        <tbody>
          {workers.map(name => (
            <tr key={name} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 12px', color: '#1a2332' }}>{name}</td>
              <td style={{ padding: '8px 12px' }}>
                <select
                  value={workerReplacements[name] ?? ''}
                  onChange={e => setWorkerReplacements({ ...workerReplacements, [name]: e.target.value })}
                  style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', width: '100%', background: 'white' }}
                >
                  <option value="">— ללא שינוי —</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step3Content({ depsResult }: { depsResult: { created: number; skipped: number } | null }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>🔗 תלויות ועדכון זמנים</h3>
      <p style={{ margin: '0 0 16px', color: '#666', fontSize: '13px' }}>
        יצירת תלויות אוטומטיות בין משימות של אותו עובד (לפי סדר), ואחריה חישוב זמני ביצוע לפי שרשראות התלות.
      </p>

      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ fontWeight: 'bold', color: '#1a2332', marginBottom: '8px', fontSize: '14px' }}>מה יקרה:</div>
        <ul style={{ margin: 0, paddingRight: '20px', color: '#64748b', fontSize: '13px', lineHeight: '1.8' }}>
          <li>לכל עובד, כל משימה שלו תהיה תלויה במשימה הקודמת שלו (בתוך אותו שלב)</li>
          <li>תלויות קיימות לא יידרסו</li>
          <li>לאחר יצירת התלויות — המערכת תחשב מחדש את זמני כל המשימות</li>
        </ul>
      </div>

      <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: '#92400e' }}>
        💡 <strong>לחץ "רק חשב זמנים"</strong> אם כבר יצרת תלויות ורוצה רק לעדכן את הזמנים לפיהן.
      </div>

      {depsResult && (
        <div style={{ marginTop: '16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '12px 16px', fontSize: '14px', color: '#166534' }}>
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
    padding: '9px 10px', textAlign: 'right', borderBottom: '2px solid #cbd5e1',
    color: '#1e293b', fontWeight: '700', fontSize: '12px', background: '#e2e8f0',
  };
  const thC: React.CSSProperties = { ...thStyle, textAlign: 'center' };

  if (anomalies === null) {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>🔍 בדיקת חריגות</h3>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
          בדיקה אם משימות כלשהן חורגות מסיום השלב המתוכנן.
        </p>
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          לחץ "בדוק חריגות" כדי לבצע את הבדיקה
        </div>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>🔍 בדיקת חריגות</h3>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
          <div style={{ color: '#166534', fontWeight: 'bold', fontSize: '16px' }}>לא נמצאו חריגות</div>
          <div style={{ color: '#999', fontSize: '13px', marginTop: '8px' }}>כל המשימות בתוך מסגרת הזמן של השלב</div>
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
      <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>🔍 בדיקת חריגות</h3>
      <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#b91c1c', fontSize: '14px', fontWeight: 'bold' }}>
        ⚠️ נמצאו {anomalies.length} חריגות — משימות שיסתיימו אחרי סיום השלב
      </div>

      {Object.entries(byPhase).map(([phaseName, items]) => (
        <div key={phaseName} style={{ marginBottom: '20px' }}>
          <div style={{ fontWeight: 'bold', color: '#1a2332', marginBottom: '8px', fontSize: '14px', padding: '6px 12px', background: '#fef2f2', borderRadius: '6px', borderRight: '3px solid #f87171' }}>
            שלב: {phaseName}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
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
                  <tr style={{ borderBottom: rowErrors[a.taskId] ? 'none' : '1px solid #f1f5f9', background: 'white' }}>
                    <td style={{ padding: '8px 10px', color: '#1a2332', fontWeight: '500' }}>
                      {a.taskTitle}
                      {a.assignedUserName && <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>👤 {a.assignedUserName}</span>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="text"
                          value={editDur[a.taskId] !== undefined ? editDur[a.taskId] : (a.duration ?? '')}
                          onChange={e => setEditDur(p => ({ ...p, [a.taskId]: e.target.value }))}
                          placeholder="30ד / 1ש30ד"
                          style={{ width: '72px', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: '5px', fontSize: '12px', direction: 'ltr', textAlign: 'center' }}
                        />
                        <button
                          onClick={() => saveDuration(a.taskId, a.duration)}
                          disabled={saving === a.taskId}
                          style={{ padding: '4px 8px', background: saving === a.taskId ? '#94a3b8' : '#2d4a7a', color: 'white', border: 'none', borderRadius: '5px', cursor: saving === a.taskId ? 'not-allowed' : 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
                        >
                          {saving === a.taskId ? '...' : 'עדכן'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#dc2626', direction: 'ltr', fontWeight: '600' }}>
                      {new Date(a.taskEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b', direction: 'ltr' }}>
                      {new Date(a.phaseEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 'bold' }}>
                      +{a.overrunMins}ד'
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {(a.dependencies ?? []).length === 0 ? (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>—</span>
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
                                style={{ padding: '3px 7px', background: removing === key ? '#94a3b8' : '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '4px', cursor: removing === key ? 'not-allowed' : 'pointer', fontSize: '11px', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}
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
                      <td colSpan={6} style={{ padding: '2px 10px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{ color: '#dc2626', fontSize: '11px' }}>⚠️ {rowErrors[a.taskId]}</span>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
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
      <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#1a2332' }}>🔀 מיון כרונולוגי</h3>
      <p style={{ margin: '0 0 16px', color: '#666', fontSize: '13px' }}>
        מסדר את orderIndex של משימות לפי plannedStart בתוך כל תת-שלב.
      </p>

      {sortResult ? (
        <div style={{ textAlign: 'center', padding: '30px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
          <div style={{ color: '#166534', fontWeight: 'bold', fontSize: '16px' }}>
            {sortResult.reordered > 0 ? `${sortResult.reordered} משימות מוינו מחדש` : 'הסדר כבר תקין — אין שינויים נדרשים'}
          </div>
        </div>
      ) : sample.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>ℹ️</div>
          אין משימות עם זמנים מתוכננים הדורשות מיון
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: '600', color: '#1a2332', marginBottom: '12px', fontSize: '13px' }}>תצוגה מקדימה — תת-שלבים שישתנו:</div>
          {sample.map((s, i) => (
            <div key={i} style={{ marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: '#f1f5f9', fontWeight: '600', fontSize: '13px', color: '#1a2332' }}>
                {s.phaseName} › {s.subName}
              </div>
              <div style={{ padding: '10px 14px' }}>
                {s.tasks.map((t: any, ti: number) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', fontSize: '13px', color: '#374151' }}>
                    <span style={{ color: '#94a3b8', minWidth: '20px' }}>{ti + 1}.</span>
                    <span style={{ color: '#2563eb', minWidth: '50px', direction: 'ltr', fontFamily: 'monospace' }}>
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

export function PlanWizard({ version, token, users, onClose, onRefresh }: PlanWizardProps) {
  const headers = { Authorization: `Bearer ${token}` };

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

  const [workerReplacements, setWorkerReplacements] = useState<Record<string, string>>({});
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
      const res = await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases }, { headers });
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
    const entries = Object.entries(workerReplacements).filter(([, toId]) => toId);
    if (entries.length === 0) { await markStep('done'); return; }
    setLoading(true);
    setError(null);
    try {
      for (const [fromName, toId] of entries) {
        await axios.patch(`${API}/versions/${version.id}/reassign-tasks`, { fromUserName: fromName, toUserId: toId }, { headers });
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
        await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases, respectDeps: true }, { headers });
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
      await axios.post(`${API}/versions/${version.id}/reschedule?preview=false`, { phases, respectDeps: true }, { headers });
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
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,0.72)', backdropFilter: 'blur(2px)' }} onClick={onClose} />

      <div style={{
        position: 'relative', zIndex: 1, maxWidth: 860,
        margin: '32px auto', background: 'white', borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 64px)',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '18px 28px 16px', background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 'bold', letterSpacing: '0.3px' }}>🔧 הכן תוכנית</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>{version.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '13px', cursor: 'pointer', padding: '7px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ✕ שמור וצא
          </button>
        </div>

        {/* ── Progress bar ── */}
        <div style={{ padding: '14px 28px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            {STEP_LABELS.map((label, i) => {
              const key = stepKeys[i];
              const status = wizState[key];
              const isActive = step === i;
              const isDone = status === 'done';
              const isSkipped = status === 'skipped';
              const bg = isActive ? '#2d4a7a' : isDone ? '#16a34a' : isSkipped ? '#94a3b8' : '#e2e8f0';
              const fg = (isActive || isDone || isSkipped) ? 'white' : '#64748b';
              return (
                <React.Fragment key={i}>
                  <button
                    onClick={() => { setStep(i); setError(null); setStepMessage(null); }}
                    style={{ flex: 1, padding: '8px 6px', border: 'none', borderRadius: '8px', cursor: 'pointer', background: bg, color: fg, fontSize: '12px', fontWeight: isActive ? '700' : '500', transition: 'background 0.2s', lineHeight: 1.4 }}
                  >
                    <div style={{ fontSize: '14px', marginBottom: '3px' }}>
                      {isDone ? '✅' : isSkipped ? '⊘' : isActive ? '●' : `${i + 1}`}
                    </div>
                    {label}
                  </button>
                  {i < 4 && (
                    <div style={{ width: '18px', alignSelf: 'center', height: '2px', background: isDone ? '#16a34a' : '#e2e8f0', flexShrink: 0 }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Step content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {error && (
            <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#b91c1c', fontSize: '14px' }}>
              ⚠️ {error}
            </div>
          )}
          {stepMessage && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#166534', fontSize: '14px' }}>
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
              workerReplacements={workerReplacements}
              setWorkerReplacements={setWorkerReplacements}
            />
          )}
          {step === 2 && <Step3Content depsResult={depsResult} />}
          {step === 3 && <Step4Content anomalies={anomalies} versionId={version.id} token={token} onRedetect={executeStep4} />}
          {step === 4 && <Step5Content sortResult={sortResult} version={version} />}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '14px 28px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => { setStep(s => Math.max(0, s - 1)); setError(null); setStepMessage(null); }}
              disabled={step === 0}
              style={{ padding: '9px 18px', background: step === 0 ? '#f1f5f9' : '#e2e8f0', border: 'none', borderRadius: '8px', cursor: step === 0 ? 'not-allowed' : 'pointer', color: step === 0 ? '#94a3b8' : '#374151', fontSize: '14px' }}
            >
              → חזור
            </button>
            <button
              onClick={onClose}
              style={{ padding: '9px 18px', background: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
            >
              ✕ סגור ללא שמירה
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => markStep('skipped')}
              disabled={loading}
              style={{ padding: '9px 18px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px' }}
            >
              דלג ←
            </button>

            {step === 0 && (
              <button onClick={executeStep1} disabled={loading} style={btnStyle('#2d4a7a')}>
                {loading ? '...' : '📅 קבע מסגרת ותזמן'}
              </button>
            )}
            {step === 1 && (
              <button onClick={executeStep2} disabled={loading} style={btnStyle('#e67e22')}>
                {loading ? '...' : '🔄 החלף עובדים'}
              </button>
            )}
            {step === 2 && (
              <>
                <button onClick={executeStep3CalcOnly} disabled={loading} style={btnStyle('#64748b')}>
                  {loading ? '...' : '⏱ רק חשב זמנים'}
                </button>
                <button onClick={executeStep3Full} disabled={loading} style={btnStyle('#2d4a7a')}>
                  {loading ? '...' : '🔗 צור תלויות וחשב'}
                </button>
              </>
            )}
            {step === 3 && anomalies === null && (
              <button onClick={executeStep4} disabled={loading} style={btnStyle('#2d4a7a')}>
                {loading ? '...' : '🔍 בדוק חריגות'}
              </button>
            )}
            {step === 3 && anomalies !== null && anomalies.length > 0 && (
              <button onClick={() => markStep('done')} disabled={loading} style={btnStyle('#e67e22')}>
                המשך בכל זאת ←
              </button>
            )}
            {step === 4 && (
              <button onClick={executeStep5} disabled={loading} style={btnStyle('#2d4a7a')}>
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
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontSize: '14px', fontWeight: 'bold',
  };
}
