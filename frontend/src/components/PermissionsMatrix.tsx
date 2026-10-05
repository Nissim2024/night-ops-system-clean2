import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { usePermissions } from '../context/PermissionsContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// AdminPanel → הרשאות (user ask 2026-10-05): a module → component tree.
// Tick a module = the whole module (including components added later); tick
// components = only those. Grants by ROLE, and by TEAM (all members / team
// leads / members) - a user gets their role's grants plus every team's they
// belong to. One save for everything changed.

interface CatalogItem { key: string; label: string; kind: 'screen' | 'action' }
interface CatalogModule { id: string; key: string; label: string; icon: string; items: CatalogItem[] }
interface TeamGrant { ALL: string[]; LEAD: string[]; MEMBER: string[] }
type Grants = Record<string, string[]>;   // column id -> granted keys

const ROLE_COLUMNS = [
  { id: 'RELEASE_MANAGER', label: 'מנהל לילה' },
  { id: 'CR_MANAGER', label: 'מנהל CR' },
  { id: 'TEAM_LEAD', label: 'ראש צוות' },
  { id: 'EMPLOYEE', label: 'עובד' },
  { id: 'VIEWER', label: 'צופה' },
];
const TEAM_COLUMNS = [
  { id: 'ALL', label: 'כל חברי הצוות' },
  { id: 'LEAD', label: 'ראש הצוות' },
  { id: 'MEMBER', label: 'חבר צוות' },
];

type State = 'all' | 'some' | 'none';

const TriBox: React.FC<{ state: State; onClick: () => void; title?: string }> = ({ state, onClick, title }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return (
    <input ref={ref} type="checkbox" checked={state === 'all'} onChange={onClick} title={title}
      className="h-4 w-4 cursor-pointer" style={{ accentColor: C.brand }} />
  );
};

export const PermissionsMatrix: React.FC<{ token: string }> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const { reload } = usePermissions();
  const [catalog, setCatalog] = useState<CatalogModule[]>([]);
  const [roleGrants, setRoleGrants] = useState<Grants>({});
  const [teamGrants, setTeamGrants] = useState<Record<string, TeamGrant>>({});
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<{ roles: Grants; teams: Record<string, TeamGrant> } | null>(null);
  const [mode, setMode] = useState<'roles' | 'team'>('roles');
  const [teamId, setTeamId] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [cat, roles, tg, tm] = await Promise.all([
      axios.get(`${API}/permissions/catalog`, { headers }),
      axios.get(`${API}/permissions`, { headers }),
      axios.get(`${API}/permissions/teams`, { headers }),
      axios.get(`${API}/teams`, { headers }),
    ]);
    setCatalog(cat.data ?? []);
    setRoleGrants(roles.data ?? {});
    setTeamGrants(tg.data ?? {});
    setTeams((tm.data ?? []).map((t: any) => ({ id: t.id, name: t.name })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
    setSaved({ roles: roles.data ?? {}, teams: tg.data ?? {} });
  };
  useEffect(() => { load().catch(() => setMsg({ ok: false, text: 'טעינת ההרשאות נכשלה' })); }, [headers]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = mode === 'roles' ? ROLE_COLUMNS : TEAM_COLUMNS;
  const grantsOf = (col: string): string[] => mode === 'roles'
    ? (roleGrants[col] ?? [])
    : ((teamGrants[teamId] as any)?.[col] ?? []);
  const setGrantsOf = (col: string, keys: string[]) => {
    setMsg(null);
    if (mode === 'roles') setRoleGrants(g => ({ ...g, [col]: keys }));
    else setTeamGrants(g => ({ ...g, [teamId]: { ...{ ALL: [], LEAD: [], MEMBER: [] }, ...g[teamId], [col]: keys } }));
  };

  const moduleState = (m: CatalogModule, col: string): State => {
    const g = grantsOf(col);
    if (g.includes(m.key)) return 'all';
    const n = m.items.filter(i => g.includes(i.key)).length;
    return n === 0 ? 'none' : n === m.items.length ? 'all' : 'some';
  };
  const itemOn = (m: CatalogModule, i: CatalogItem, col: string) => {
    const g = grantsOf(col);
    return g.includes(m.key) || g.includes(i.key);
  };
  const toggleModule = (m: CatalogModule, col: string) => {
    const g = grantsOf(col).filter(k => k !== m.key && !m.items.some(i => i.key === k));
    setGrantsOf(col, moduleState(m, col) === 'all' ? g : [...g, m.key]);
  };
  const toggleItem = (m: CatalogModule, i: CatalogItem, col: string) => {
    const g = grantsOf(col);
    if (g.includes(m.key)) {
      // whole module -> every component except this one
      setGrantsOf(col, [...g.filter(k => k !== m.key), ...m.items.filter(x => x.key !== i.key).map(x => x.key)]);
    } else if (g.includes(i.key)) {
      setGrantsOf(col, g.filter(k => k !== i.key));
    } else {
      setGrantsOf(col, [...g, i.key]);
    }
  };

  const same = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every(k => b.includes(k));
  const dirtyRoles = saved ? ROLE_COLUMNS.filter(c => !same(roleGrants[c.id], saved.roles[c.id])).map(c => c.id) : [];
  const dirtyTeams = saved ? JSON.stringify(teamGrants) !== JSON.stringify(saved.teams) : false;
  const dirty = dirtyRoles.length > 0 || dirtyTeams;

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      for (const role of dirtyRoles) await axios.put(`${API}/permissions/${role}`, { permissions: roleGrants[role] ?? [] }, { headers });
      if (dirtyTeams) await axios.put(`${API}/permissions/teams`, teamGrants, { headers });
      await load();
      await reload();
      setMsg({ ok: true, text: 'ההרשאות נשמרו' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || 'השמירה נכשלה' });
    } finally {
      setSaving(false);
    }
  };

  const teamsWithGrants = new Set(Object.entries(teamGrants).filter(([, g]) => (g.ALL?.length ?? 0) + (g.LEAD?.length ?? 0) + (g.MEMBER?.length ?? 0) > 0).map(([id]) => id));
  const th = 'border-b border-border px-3 py-2 text-center text-[13px] font-bold text-muted-foreground';
  const td = 'border-b border-border px-3 py-1.5 text-center';

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div>
        <div className="text-base font-bold text-foreground">🔐 ניהול הרשאות</div>
        <div className="mt-1 text-sm leading-relaxed text-subtle-foreground">
          סימון מודול נותן את <b>כל</b> המודול — כולל רכיבים שיתווספו אליו בעתיד. ◩ = רק חלק מהרכיבים. פתח מודול (▶) כדי לתת רכיבים בודדים.
          משתמש מקבל את הרשאות <b>התפקיד</b> שלו ועוד את הרשאות <b>כל צוות</b> שהוא חבר בו. מנהל מערכת מקבל הכל תמיד.
          הגישה למודול נאכפת גם בשרת, לא רק בתצוגה.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['roles', 'team'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`cursor-pointer rounded-md border px-3.5 py-1.5 text-sm font-semibold ${mode === m ? 'border-primary bg-primary text-white' : 'border-border bg-card text-foreground'}`}>
            {m === 'roles' ? 'לפי תפקיד' : 'לפי צוות'}
          </button>
        ))}
        {mode === 'team' && (
          <select value={teamId} onChange={e => setTeamId(e.target.value)} className="min-w-[240px] rounded-md border border-border bg-card px-3 py-1.5 text-sm">
            <option value="">— בחר צוות —</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}{teamsWithGrants.has(t.id) ? ' ✓' : ''}</option>)}
          </select>
        )}
        {mode === 'team' && <span className="text-xs text-subtle-foreground">✓ = לצוות יש הרשאות</span>}
      </div>

      {mode === 'team' && !teamId ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm text-subtle-foreground">בחר צוות כדי לראות ולערוך את ההרשאות שלו.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-right`} style={{ minWidth: 260 }}>מודול / רכיב</th>
                {columns.map(c => <th key={c.id} className={th}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {catalog.map(m => (
                <React.Fragment key={m.key}>
                  <tr style={{ background: C.bgNested }}>
                    <td className={`${td} text-right`}>
                      <button onClick={() => setOpen(o => ({ ...o, [m.key]: !o[m.key] }))}
                        className="cursor-pointer border-none bg-transparent p-0 text-sm font-bold text-foreground">
                        <span className="inline-block w-4 text-muted-foreground">{open[m.key] ? '▼' : '▶'}</span> {m.icon} {m.label}
                        <span className="mr-2 text-xs font-normal text-subtle-foreground">({m.items.length})</span>
                      </button>
                    </td>
                    {columns.map(c => (
                      <td key={c.id} className={td}>
                        <TriBox state={moduleState(m, c.id)} onClick={() => toggleModule(m, c.id)} title={`כל המודול "${m.label}"`} />
                      </td>
                    ))}
                  </tr>
                  {open[m.key] && m.items.map(i => (
                    <tr key={i.key}>
                      <td className={`${td} text-right text-sm text-foreground`} style={{ paddingRight: 40 }}>
                        {i.label}
                        <span className="mr-2 text-[11px] text-subtle-foreground">{i.kind === 'screen' ? 'מסך' : 'פעולה'}</span>
                      </td>
                      {columns.map(c => (
                        <td key={c.id} className={td}>
                          <TriBox state={itemOn(m, i, c.id) ? 'all' : 'none'} onClick={() => toggleItem(m, i, c.id)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={!dirty || saving}
          className={`rounded-md border-none px-4 py-2 text-sm font-bold text-white ${!dirty || saving ? 'cursor-default bg-subtle-foreground' : 'cursor-pointer bg-primary'}`}>
          {saving ? 'שומר…' : '💾 שמור שינויים'}
        </button>
        {dirty && !saving && (
          <button onClick={() => { if (saved) { setRoleGrants(saved.roles); setTeamGrants(saved.teams); setMsg(null); } }}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">בטל שינויים</button>
        )}
        {dirty && <span className="text-xs text-subtle-foreground">יש שינויים שלא נשמרו</span>}
        {msg && <span className={`text-sm font-semibold ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span>}
      </div>
    </div>
  );
};
