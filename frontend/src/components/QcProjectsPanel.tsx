import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { useDialog } from '../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// QC projects (2026-10-09, multi-project): which QC projects DeployCenter
// works with, DeployCenter's own display name for each (QC never changes),
// who may log in to it, its Oracle schema, and whether QC writes are on — a
// new project starts read-only until its defect fields are compared with the
// default project's ("השוואת שדות").

interface ProjectRow {
  id: string; key: string; displayName: string; domain: string; restProject: string; oracleSchema: string | null;
  active: boolean; isDefault: boolean; writeEnabled: boolean; sortOrder: number;
  access: { userId: string | null; teamId: string | null }[];
}
type Draft = Partial<Pick<ProjectRow, 'displayName' | 'domain' | 'restProject' | 'oracleSchema' | 'active' | 'isDefault' | 'writeEnabled'>>;

const input = 'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary';
const btn = 'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = 'cursor-pointer rounded-md border-none bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

export const QcProjectsPanel: React.FC<{ token: string }> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const dialog = useDialog();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [users, setUsers] = useState<{ id: string; fullName?: string; email: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(() => {
    axios.get(`${API}/qc-projects`, { headers }).then(r => setRows(r.data ?? [])).catch(e => setMsg({ kind: 'err', text: e?.response?.data?.message || 'טעינת הפרויקטים נכשלה' }));
  }, [headers]);
  useEffect(() => {
    load();
    axios.get(`${API}/users`, { headers }).then(r => setUsers(r.data ?? [])).catch(() => {});
    axios.get(`${API}/teams`, { headers }).then(r => setTeams(r.data ?? [])).catch(() => {});
  }, [load, headers]);

  const fail = (e: any, text: string) => setMsg({ kind: 'err', text: e?.response?.data?.message || text });

  // ── new project / discover from QC
  const [adding, setAdding] = useState<Draft | null>(null);
  const [discovered, setDiscovered] = useState<{ domain: string; projects: { name: string; configured: boolean }[] } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const defaultDomain = rows.find(r => r.isDefault)?.domain ?? '';
  const discover = async () => {
    setDiscovering(true); setMsg(null);
    try { setDiscovered((await axios.get(`${API}/qc-projects/discover/${encodeURIComponent(defaultDomain || 'DEFAULT')}`, { headers })).data); }
    catch (e) { fail(e, 'טעינת הפרויקטים מ-QC נכשלה'); }
    finally { setDiscovering(false); }
  };
  const create = async (d: Draft) => {
    setMsg(null);
    try {
      await axios.post(`${API}/qc-projects`, d, { headers });
      setAdding(null);
      setMsg({ kind: 'ok', text: `הפרויקט ${d.displayName || d.restProject} נוסף — הכתיבה ל-QC כבויה עד אימות השדות` });
      load();
    } catch (e) { fail(e, 'הוספת הפרויקט נכשלה'); }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-bold text-foreground">📁 פרויקטי QC</h3>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            הפרויקטים שהמערכת עובדת מולם. הפרויקט נבחר במסך הכניסה; "שם לתצוגה" הוא השם במערכת שלנו בלבד — ב-QC לא משתנה דבר.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={discover} disabled={discovering}>{discovering ? 'טוען…' : '🔍 טען פרויקטים מ-QC'}</button>
          <button type="button" className={btnPrimary} onClick={() => setAdding({ domain: defaultDomain, restProject: '', displayName: '', oracleSchema: '' })}>+ פרויקט</button>
        </div>
      </div>

      {msg && <div className={cn('rounded-md px-3 py-2 text-[13px] font-semibold', msg.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>{msg.text}</div>}

      {discovered && (
        <div className="rounded-lg border border-border p-3 text-[13px]">
          <div className="mb-2 font-semibold">פרויקטים ב-QC (Domain {discovered.domain}):</div>
          <div className="flex flex-wrap gap-2">
            {discovered.projects.map(p => (
              <button key={p.name} type="button" disabled={p.configured} className={btn}
                title={p.configured ? 'כבר מוגדר' : 'הוסף את הפרויקט'}
                onClick={() => setAdding({ domain: discovered.domain, restProject: p.name, displayName: p.name, oracleSchema: '' })}>
                {p.configured ? '✓ ' : '+ '}{p.name}
              </button>
            ))}
            {discovered.projects.length === 0 && <span className="text-muted-foreground">QC לא החזיר פרויקטים</span>}
          </div>
        </div>
      )}

      {adding && (
        <ProjectForm draft={adding} onCancel={() => setAdding(null)} onSave={create} />
      )}

      <div className="flex flex-col gap-3">
        {rows.map(r => (
          <ProjectCard key={r.id} row={r} users={users} teams={teams} headers={headers}
            onChanged={load} onMsg={setMsg} confirm={dialog.confirm} />
        ))}
      </div>
    </div>
  );
};

const ProjectForm: React.FC<{ draft: Draft; onSave: (d: Draft) => void; onCancel: () => void }> = ({ draft, onSave, onCancel }) => {
  const [d, setD] = useState<Draft>(draft);
  const set = (k: keyof Draft, v: any) => setD(prev => ({ ...prev, [k]: v }));
  return (
    <div className="grid gap-3 rounded-lg p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', border: `1px solid ${C.border}`, background: C.bgNested }}>
      <Field label="שם לתצוגה (במערכת שלנו)"><input className={input} value={d.displayName ?? ''} onChange={e => set('displayName', e.target.value)} dir="auto" /></Field>
      <Field label="Domain ב-QC"><input className={input} value={d.domain ?? ''} onChange={e => set('domain', e.target.value)} dir="ltr" /></Field>
      <Field label="פרויקט ב-QC"><input className={input} value={d.restProject ?? ''} onChange={e => set('restProject', e.target.value)} dir="ltr" /></Field>
      <Field label="סכמת Oracle (ריק = כמו היום)"><input className={input} value={d.oracleSchema ?? ''} onChange={e => set('oracleSchema', e.target.value)} dir="ltr" placeholder="HOTAPPS_DB" /></Field>
      <div className="col-span-full flex justify-end gap-2">
        <button type="button" className={btn} onClick={onCancel}>ביטול</button>
        <button type="button" className={btnPrimary} onClick={() => onSave(d)} disabled={!d.restProject?.trim() || !d.domain?.trim()}>שמור</button>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">{label}{children}</label>
);

const ProjectCard: React.FC<{
  row: ProjectRow; users: { id: string; fullName?: string; email: string }[]; teams: { id: string; name: string }[];
  headers: Record<string, string>; onChanged: () => void; onMsg: (m: { kind: 'ok' | 'err'; text: string } | null) => void;
  confirm: (message: string, title?: string, variant?: any) => Promise<boolean>;
}> = ({ row, users, teams, headers, onChanged, onMsg, confirm }) => {
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<'access' | 'test' | 'compare' | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ oracle: { ok: boolean; message: string }; rest: { ok: boolean; message: string } } | null>(null);
  const [compare, setCompare] = useState<{ base: string; total: number; different: number; rows: { name: string; baseLabel: string | null; label: string | null; diffs: string[] }[] } | null>(null);
  const fail = (e: any, text: string) => onMsg({ kind: 'err', text: e?.response?.data?.message || text });

  const patch = async (data: Draft, okText: string) => {
    onMsg(null);
    try { await axios.patch(`${API}/qc-projects/${row.id}`, data, { headers }); onMsg({ kind: 'ok', text: okText }); onChanged(); }
    catch (e) { fail(e, 'השמירה נכשלה'); }
  };
  const toggleWrite = async () => {
    if (!row.writeEnabled && !await confirm(
      `להפעיל כתיבה ל-QC בפרויקט ${row.displayName}? מומלץ רק אחרי "השוואת שדות" ללא הבדלים — כתיבה עם מיפוי שדות שגוי עלולה לעדכן שדה אחר ב-QC.`,
      'הפעלת כתיבה ל-QC', 'warning')) return;
    patch({ writeEnabled: !row.writeEnabled }, row.writeEnabled ? 'הכתיבה ל-QC כובתה' : 'הכתיבה ל-QC הופעלה');
  };
  const runTest = async () => {
    setPanel('test'); setBusy(true); setTest(null);
    try { setTest((await axios.post(`${API}/qc-projects/${row.id}/test`, {}, { headers })).data); }
    catch (e) { fail(e, 'בדיקת החיבור נכשלה'); }
    finally { setBusy(false); }
  };
  const runCompare = async () => {
    setPanel('compare'); setBusy(true); setCompare(null);
    try { setCompare((await axios.get(`${API}/qc-projects/${row.id}/field-compare`, { headers })).data); }
    catch (e) { fail(e, 'השוואת השדות נכשלה'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirm(`למחוק את הפרויקט ${row.displayName} מהמערכת? (ב-QC לא נמחק דבר)`, 'מחיקת פרויקט', 'danger')) return;
    try { await axios.delete(`${API}/qc-projects/${row.id}`, { headers }); onChanged(); } catch (e) { fail(e, 'המחיקה נכשלה'); }
  };

  const accessUsers = row.access.filter(a => a.userId).length;
  const accessTeams = row.access.filter(a => a.teamId).length;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg p-3.5" style={{ background: row.active ? C.bgCard : C.bgNested, border: `1px solid ${C.border}` }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[15px] font-bold text-foreground" dir="auto">{row.displayName}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">{row.domain} / {row.restProject}</span>
        {row.isDefault && <Chip color={C.brand}>ברירת מחדל</Chip>}
        {!row.active && <Chip color={C.textMuted}>לא פעיל</Chip>}
        <Chip color={row.writeEnabled ? C.success : C.warning}>{row.writeEnabled ? 'כתיבה ל-QC פעילה' : 'קריאה בלבד'}</Chip>
        <span className="text-xs text-muted-foreground">Oracle: <span className="font-mono" dir="ltr">{row.oracleSchema || 'הסכמה של משתמש החיבור'}</span></span>
        <span className="text-xs text-muted-foreground">
          · גישה: {row.isDefault ? 'כל המשתמשים' : `${accessUsers} משתמשים, ${accessTeams} צוותים + מנהלי מערכת`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => setEditing(v => !v)}>✏️ עריכה</button>
        {!row.isDefault && <button type="button" className={btn} onClick={() => setPanel(p => (p === 'access' ? null : 'access'))}>👥 מי רשאי להיכנס</button>}
        <button type="button" className={btn} onClick={runTest} disabled={busy}>🔌 בדוק חיבור</button>
        {!row.isDefault && <button type="button" className={btn} onClick={runCompare} disabled={busy}>🧩 השוואת שדות</button>}
        <button type="button" className={btn} onClick={toggleWrite}>{row.writeEnabled ? '⛔ כבה כתיבה ל-QC' : '✅ הפעל כתיבה ל-QC'}</button>
        {!row.isDefault && <button type="button" className={btn} onClick={() => patch({ active: !row.active }, row.active ? 'הפרויקט הושבת' : 'הפרויקט הופעל')}>{row.active ? 'השבת' : 'הפעל'}</button>}
        {!row.isDefault && row.active && <button type="button" className={btn} onClick={() => patch({ isDefault: true }, 'נקבע כברירת מחדל')}>קבע כברירת מחדל</button>}
        {!row.isDefault && <button type="button" className={btn} onClick={remove}>🗑 מחק</button>}
      </div>

      {editing && (
        <ProjectForm draft={{ displayName: row.displayName, domain: row.domain, restProject: row.restProject, oracleSchema: row.oracleSchema ?? '' }}
          onCancel={() => setEditing(false)}
          onSave={d => { setEditing(false); patch({ displayName: d.displayName, domain: d.domain, restProject: d.restProject, oracleSchema: d.oracleSchema }, 'הפרויקט עודכן'); }} />
      )}
      {panel === 'access' && <AccessEditor row={row} users={users} teams={teams} headers={headers} onSaved={() => { setPanel(null); onChanged(); onMsg({ kind: 'ok', text: 'הגישה עודכנה' }); }} onError={e => fail(e, 'עדכון הגישה נכשל')} />}
      {panel === 'test' && (
        <div className="rounded-md bg-muted/50 p-2.5 text-[13px]">
          {busy && 'בודק…'}
          {test && [test.oracle, test.rest].map((t, i) => <div key={i} className={t.ok ? 'text-success' : 'text-danger'}>{t.ok ? '✓' : '✗'} {t.message}</div>)}
        </div>
      )}
      {panel === 'compare' && (
        <div className="rounded-md bg-muted/50 p-2.5 text-[13px]">
          {busy && 'משווה את שדות התקלה מול QC…'}
          {compare && (
            <>
              <div className={cn('mb-2 font-semibold', compare.different ? 'text-warning' : 'text-success')}>
                {compare.different ? `${compare.different} מתוך ${compare.total} שדות שונים מ-${compare.base}` : `כל ${compare.total} השדות זהים ל-${compare.base} — אפשר להפעיל כתיבה`}
              </div>
              {compare.different > 0 && (
                <table className="w-full border-collapse text-xs">
                  <thead><tr className="text-right text-muted-foreground"><th className="py-1">שדה (REST)</th><th className="py-1">ב-{compare.base}</th><th className="py-1">בפרויקט זה</th><th className="py-1">הבדל</th></tr></thead>
                  <tbody>
                    {compare.rows.filter(x => x.diffs.length).map(x => (
                      <tr key={x.name} className="border-t border-border">
                        <td className="py-1 font-mono" dir="ltr" style={{ textAlign: 'right' }}>{x.name}</td>
                        <td className="py-1">{x.baseLabel ?? '—'}</td>
                        <td className="py-1">{x.label ?? '—'}</td>
                        <td className="py-1 text-warning">{x.diffs.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const Chip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color, border: `1px solid ${color}`, background: C.bgCard }}>{children}</span>
);

const AccessEditor: React.FC<{
  row: ProjectRow; users: { id: string; fullName?: string; email: string }[]; teams: { id: string; name: string }[];
  headers: Record<string, string>; onSaved: () => void; onError: (e: any) => void;
}> = ({ row, users, teams, headers, onSaved, onError }) => {
  const [userIds, setUserIds] = useState<Set<string>>(new Set(row.access.map(a => a.userId).filter((x): x is string => !!x)));
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set(row.access.map(a => a.teamId).filter((x): x is string => !!x)));
  const [q, setQ] = useState('');
  const toggle = (set: Set<string>, id: string, upd: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); upd(n); };
  const shownUsers = users.filter(u => !q.trim() || `${u.fullName ?? ''} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const save = async () => {
    try { await axios.put(`${API}/qc-projects/${row.id}/access`, { userIds: Array.from(userIds), teamIds: Array.from(teamIds) }, { headers }); onSaved(); }
    catch (e) { onError(e); }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-[13px]">
      <div className="text-xs text-muted-foreground">מנהלי מערכת נכנסים לכל פרויקט. מי שמסומן כאן — או חבר בצוות מסומן — יראה את "{row.displayName}" ברשימת הפרויקטים בכניסה ויוכל להיכנס אליו.</div>
      <div>
        <div className="mb-1.5 font-semibold">צוותים ({teamIds.size})</div>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {teams.map(t => (
            <label key={t.id} className={cn('flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1', teamIds.has(t.id) ? 'border-primary bg-primary/5' : 'border-border')}>
              <input type="checkbox" checked={teamIds.has(t.id)} onChange={() => toggle(teamIds, t.id, setTeamIds)} />
              <span dir="auto">{t.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center gap-2 font-semibold">משתמשים ({userIds.size})
          <input className={cn(input, 'max-w-[220px] font-normal')} placeholder="חיפוש…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="grid max-h-52 gap-1 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {shownUsers.map(u => (
            <label key={u.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted">
              <input type="checkbox" checked={userIds.has(u.id)} onChange={() => toggle(userIds, u.id, setUserIds)} />
              <span className="truncate" dir="auto" title={u.email}>{u.fullName || u.email}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={save}>שמור גישה</button></div>
    </div>
  );
};
