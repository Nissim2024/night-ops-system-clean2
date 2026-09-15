import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { useDialog } from '../../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Skill {
  id: string; name: string;
  type: 'Professional' | 'Applications' | 'Tools' | 'Personal';
  weight: number;
}

interface TesterSkillEntry { skillId: string; level: number; }

interface Tester {
  userId: string; fullName: string; email: string; role: string;
  skills: TesterSkillEntry[];
}

interface AvailableUser { id: string; fullName: string; email: string; }
interface Team         { id: string; name: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

type CategoryKey = 'Professional' | 'Applications' | 'Tools' | 'Personal';
const CATEGORIES: CategoryKey[] = ['Professional', 'Applications', 'Tools', 'Personal'];

const CAT_META = {
  Professional: { label: 'מקצועיות',     color: '#4573D2', bg: 'rgba(69,115,210,0.12)' },
  Applications: { label: 'ידע',          color: '#37C47A', bg: 'rgba(55,196,122,0.12)' },
  Tools:        { label: 'כלים',         color: '#F0883E', bg: 'rgba(240,136,62,0.12)'  },
  Personal:     { label: 'אישי',         color: '#9C6ADE', bg: 'rgba(156,106,222,0.12)' },
} as const;

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  ADMIN:           { label: 'מנהל מערכת',  color: '#E05C5C', bg: 'rgba(224,92,92,0.10)'  },
  RELEASE_MANAGER: { label: 'מנהל גרסה',   color: '#9C6ADE', bg: 'rgba(156,106,222,0.10)' },
  EMPLOYEE:        { label: 'עובד',         color: '#60A5FA', bg: 'rgba(96,165,250,0.10)'  },
};

const SORT_OPTIONS = [
  { value: 'name',       label: 'שם' },
  { value: 'avg',        label: 'ממוצע' },
  { value: 'completion', label: '% מילוי' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

const avgColor = (v: number | null) => {
  if (v === null) return C.textDisabled;
  if (v < 2) return '#F0883E';
  if (v < 3) return '#E8AF00';
  if (v < 4) return '#4573D2';
  return '#37C47A';
};

interface Stats {
  totalRated: number;
  totalSkills: number;
  completion: number;
  overallAvg: number | null;
  catAvgs: Record<CategoryKey, number | null>;
}

function computeStats(tester: Tester, allSkills: Skill[]): Stats {
  const totalSkills = allSkills.length;
  const getLevel = (skillId: string) => tester.skills.find(s => s.skillId === skillId)?.level ?? 0;

  const ratedSkills = allSkills.filter(sk => getLevel(sk.id) > 0);
  const totalRated  = ratedSkills.length;
  const completion  = totalSkills > 0 ? Math.round((totalRated / totalSkills) * 100) : 0;

  const sumWL = ratedSkills.reduce((acc, sk) => acc + getLevel(sk.id) * sk.weight, 0);
  const sumW  = ratedSkills.reduce((acc, sk) => acc + sk.weight, 0);
  const overallAvg = sumW > 0 ? sumWL / sumW : null;

  const catAvgs = {} as Record<CategoryKey, number | null>;
  for (const cat of CATEGORIES) {
    const catSkills = allSkills.filter(sk => sk.type === cat);
    const catRated  = catSkills.filter(sk => getLevel(sk.id) > 0);
    if (catRated.length === 0) { catAvgs[cat] = null; continue; }
    const cWL = catRated.reduce((acc, sk) => acc + getLevel(sk.id) * sk.weight, 0);
    const cW  = catRated.reduce((acc, sk) => acc + sk.weight, 0);
    catAvgs[cat] = cW > 0 ? cWL / cW : null;
  }

  return { totalRated, totalSkills, completion, overallAvg, catAvgs };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { token: string; }

export const QaTestersView: React.FC<Props> = ({ token }) => {
  const dialog = useDialog();
  const hdrs = { headers: { Authorization: `Bearer ${token}` } };

  const [testers, setTesters] = useState<Tester[]>([]);
  const [skills,  setSkills]  = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [sortBy,  setSortBy]  = useState<typeof SORT_OPTIONS[number]['value']>('name');
  const [search,  setSearch]  = useState('');

  const [showAdd,        setShowAdd]        = useState(false);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [teams,          setTeams]          = useState<Team[]>([]);
  const [filterTeamId,   setFilterTeamId]   = useState('');
  const [savingAdd,      setSavingAdd]      = useState(false);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await axios.get(`${API}/qa/matrix`, hdrs);
      setTesters(res.data.testers);
      setSkills(res.data.skills);
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 2500); };

  const removeTester = async (tester: Tester) => {
    if (!await dialog.confirm(`להסיר את ${tester.fullName} מרשימת הבודקים?`, 'הסרת בודק', 'danger')) return;
    try {
      await axios.delete(`${API}/qa/testers/${tester.userId}`, hdrs);
      flash(`${tester.fullName} הוסר`);
      load();
    } catch (e: any) { dialog.alert(e.response?.data?.message ?? 'שגיאה', 'שגיאה', 'danger'); }
  };

  const loadAvailable = async (teamId: string) => {
    const url = teamId ? `${API}/qa/users/available?teamId=${teamId}` : `${API}/qa/users/available`;
    const res = await axios.get(url, hdrs);
    setAvailableUsers(res.data);
    setSelectedUserId(res.data[0]?.id ?? '');
  };

  const openAdd = async () => {
    setShowAdd(true);
    const res = await axios.get(`${API}/teams`, hdrs);
    const list: Team[] = res.data;
    setTeams(list);
    const qa = list.find(t => t.name.toLowerCase().includes('qa') || t.name.includes('בדיקות'));
    const defId = qa?.id ?? '';
    setFilterTeamId(defId);
    await loadAvailable(defId);
  };

  const addTester = async () => {
    if (!selectedUserId) return;
    setSavingAdd(true);
    try {
      await axios.post(`${API}/qa/testers`, { userId: selectedUserId }, hdrs);
      const u = availableUsers.find(u => u.id === selectedUserId);
      flash(`${u?.fullName} נוסף כבודק`);
      setShowAdd(false);
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה בהוספה', 'שגיאה', 'danger');
    } finally {
      setSavingAdd(false);
    }
  };

  // ── Sort + filter ────────────────────────────────────────────────────────────

  const statsMap = new Map(testers.map(t => [t.userId, computeStats(t, skills)]));

  const displayed = [...testers]
    .filter(t => !search || t.fullName.toLowerCase().includes(search.toLowerCase()) || t.email.includes(search))
    .sort((a, b) => {
      if (sortBy === 'name')       return a.fullName.localeCompare(b.fullName, 'he');
      if (sortBy === 'avg')        return (statsMap.get(b.userId)?.overallAvg ?? -1) - (statsMap.get(a.userId)?.overallAvg ?? -1);
      if (sortBy === 'completion') return (statsMap.get(b.userId)?.completion ?? 0) - (statsMap.get(a.userId)?.completion ?? 0);
      return 0;
    });

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-10 text-center text-sm text-subtle-foreground">טוען...</div>;
  if (error)   return <div className="rounded-lg bg-danger/10 p-4 text-sm text-danger" style={{ border: `1px solid ${C.danger}44` }}>{error}</div>;

  return (
    <div dir="rtl" className="font-sans text-foreground">

      {/* ── Toast ── */}
      {successMsg && (
        <div className="fixed left-1/2 top-[70px] z-[9999] -translate-x-1/2 rounded-lg bg-success px-5 py-2.5 text-sm font-semibold text-white shadow-md">
          ✓ {successMsg}
        </div>
      )}

      {/* ── Header ── */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <span>👥</span> ניהול בודקים
          </div>
          <div className="mt-0.5 text-sm text-subtle-foreground">
            {testers.length} בודקים פעילים · {skills.length} סקילים במערכת
          </div>
        </div>
        <button onClick={openAdd}
          className="cursor-pointer rounded-md border-none bg-primary px-[18px] py-2 text-sm font-semibold text-primary-foreground transition-[filter] duration-fast ease-out hover:brightness-110">
          + הוסף בודק
        </button>
      </div>

      {/* ── Search + Sort bar ── */}
      {testers.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או אימייל..."
            dir="rtl"
            className="max-w-[320px] flex-1 rounded-md border border-border bg-card px-3 py-2 font-sans text-sm text-foreground outline-none transition-colors duration-fast ease-out focus:border-primary"
          />
          <div className="flex gap-1 rounded-md bg-muted p-[3px]">
            <span className="flex items-center px-2 py-1.5 text-xs text-subtle-foreground">מיון:</span>
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                className={`rounded-sm border-none px-3 py-1.5 text-xs transition-[background,box-shadow] duration-fast ease-out ${sortBy === opt.value ? 'bg-card font-semibold text-foreground shadow-sm' : 'bg-transparent font-normal text-muted-foreground'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {testers.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-subtle-foreground">
          <div className="mb-3 text-[52px]">👥</div>
          <div className="mb-2 text-lg font-semibold text-foreground">אין בודקים עדיין</div>
          <div className="mb-5 text-sm">הוסף בודקים מתוך רשימת המשתמשים הקיימים</div>
          <button onClick={openAdd}
            className="cursor-pointer rounded-md border-none bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">
            + הוסף בודק ראשון
          </button>
        </div>
      )}

      {/* ── Tester cards grid ── */}
      {displayed.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {displayed.map(tester => {
            const s    = statsMap.get(tester.userId)!;
            const role = ROLE_META[tester.role] ?? ROLE_META.EMPLOYEE;
            const fillColor = s.completion >= 80 ? '#37C47A' : s.completion >= 50 ? '#4573D2' : s.completion >= 25 ? '#E8AF00' : '#F0883E';

            return (
              <div key={tester.userId}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-fast ease-out hover:shadow-md">

                {/* ── Card header ── */}
                <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                  {/* Avatar */}
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-info/10 text-xl font-bold text-info" style={{ border: `2px solid ${C.info}33` }}>
                    {tester.fullName.charAt(0)}
                  </div>

                  {/* Name + email + badges */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold">
                      {tester.fullName}
                    </div>
                    <div className="mb-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-subtle-foreground">
                      {tester.email}
                    </div>
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: role.color, background: role.bg }}>
                      {role.label}
                    </span>
                  </div>

                  {/* Remove button */}
                  <button onClick={() => removeTester(tester)} title="הסר בודק"
                    className="flex-shrink-0 cursor-pointer rounded-sm border-none bg-transparent p-1 text-sm text-subtle-foreground transition-colors duration-fast ease-out hover:bg-danger/10 hover:text-danger">
                    ✕
                  </button>
                </div>

                {/* ── Stats bar ── */}
                <div className="border-t border-border px-4 py-3">
                  {/* Overall score + completion */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-subtle-foreground">{s.totalRated}/{s.totalSkills} סקילים דורגו</span>
                      <span className="text-xs font-semibold" style={{ color: fillColor }}>{s.completion}%</span>
                    </div>
                    {s.overallAvg !== null && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-subtle-foreground">ממוצע</span>
                        <span className="rounded-full px-2.5 py-0.5 text-base font-bold" style={{ color: avgColor(s.overallAvg), background: `${avgColor(s.overallAvg)}18` }}>
                          {s.overallAvg.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-[width] duration-base ease-out" style={{ width: `${s.completion}%`, background: fillColor }} />
                  </div>

                  {/* Category mini scores */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {CATEGORIES.map(cat => {
                      const m   = CAT_META[cat];
                      const avg = s.catAvgs[cat];
                      const catTotal  = skills.filter(sk => sk.type === cat).length;
                      const catRated  = skills.filter(sk => sk.type === cat && (tester.skills.find(ts => ts.skillId === sk.id)?.level ?? 0) > 0).length;
                      return (
                        <div key={cat} className="flex items-center justify-between rounded-md border border-border bg-muted px-2.5 py-1.5">
                          <div>
                            <div className="text-xs font-semibold" style={{ color: m.color }}>{m.label}</div>
                            <div className="text-xs text-subtle-foreground">{catRated}/{catTotal}</div>
                          </div>
                          {avg !== null
                            ? <span className="text-[16px] font-bold" style={{ color: avgColor(avg) }}>{avg.toFixed(1)}</span>
                            : <span className="text-xs text-subtle-foreground">—</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {displayed.length === 0 && testers.length > 0 && (
        <div className="p-8 text-center text-sm text-subtle-foreground">
          לא נמצאו בודקים התואמים לחיפוש
        </div>
      )}

      {/* ── Add Tester Modal ── */}
      {showAdd && (
        <div dir="rtl" className="fixed inset-0 z-[3000] flex items-center justify-center bg-[rgba(20,21,42,0.45)]"
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="w-[420px] max-w-[94vw] overflow-hidden rounded-3xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <span className="text-lg font-bold">הוספת בודק</span>
              <button onClick={() => setShowAdd(false)} className="cursor-pointer border-none bg-transparent text-lg text-subtle-foreground">✕</button>
            </div>
            <div className="p-5">
              <label className="mb-2 block text-sm font-semibold">סנן לפי צוות</label>
              <select value={filterTeamId} onChange={e => { setFilterTeamId(e.target.value); loadAvailable(e.target.value); }}
                className="mb-4 w-full rounded-md border border-border bg-card px-3 py-2 font-sans text-sm text-foreground outline-none">
                <option value="">כל הצוותים</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              {availableUsers.length === 0 ? (
                <>
                  <div className="mb-4 rounded-md bg-muted p-4 text-center text-sm text-subtle-foreground">
                    {filterTeamId ? 'כל חברי הצוות כבר רשומים כבודקים' : 'כל המשתמשים הפעילים כבר רשומים כבודקים'}
                  </div>
                  <button onClick={() => setShowAdd(false)} className="w-full cursor-pointer rounded-md border border-border bg-muted py-2.5 text-sm text-muted-foreground">
                    סגור
                  </button>
                </>
              ) : (
                <>
                  <label className="mb-2 block text-sm font-semibold">בחר עובד</label>
                  <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                    className="mb-5 w-full rounded-md border border-border bg-card px-3 py-2 font-sans text-sm text-foreground outline-none">
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addTester} disabled={!selectedUserId || savingAdd}
                      className={`flex-1 cursor-pointer rounded-md border-none bg-primary py-2.5 text-sm font-semibold text-primary-foreground ${savingAdd ? 'opacity-50' : 'opacity-100'}`}>
                      {savingAdd ? 'מוסיף...' : 'הוסף בודק'}
                    </button>
                    <button onClick={() => setShowAdd(false)} className="flex-1 cursor-pointer rounded-md border border-border bg-muted py-2.5 text-sm text-muted-foreground">
                      ביטול
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
