import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
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

  if (loading) return <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted, ...TEXT.sm }}>טוען...</div>;
  if (error)   return <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.lg, padding: SP[4], color: C.danger, ...TEXT.sm }}>{error}</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', color: C.textPrimary }}>

      {/* ── Toast ── */}
      {successMsg && (
        <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: C.success, color: C.textInverse, padding: '10px 20px', borderRadius: RADIUS.lg, ...TEXT.sm, fontWeight: WEIGHT.semibold, boxShadow: SHADOW.md }}>
          ✓ {successMsg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[4] }}>
        <div>
          <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, display: 'flex', alignItems: 'center', gap: SP[2] }}>
            <span>👥</span> ניהול בודקים
          </div>
          <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: '2px' }}>
            {testers.length} בודקים פעילים · {skills.length} סקילים במערכת
          </div>
        </div>
        <button onClick={openAdd}
          style={{ background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '8px 18px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, transition: EASE.fast }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
          onMouseLeave={e => e.currentTarget.style.filter = 'none'}>
          + הוסף בודק
        </button>
      </div>

      {/* ── Search + Sort bar ── */}
      {testers.length > 0 && (
        <div style={{ display: 'flex', gap: SP[3], marginBottom: SP[4], alignItems: 'center' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או אימייל..."
            style={{ flex: 1, maxWidth: '320px', padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, fontFamily: FONT, ...TEXT.sm, outline: 'none', background: C.bgCard, color: C.textPrimary, direction: 'rtl' }}
            onFocus={e => e.currentTarget.style.borderColor = C.borderFocus}
            onBlur={e => e.currentTarget.style.borderColor = C.border}
          />
          <div style={{ display: 'flex', gap: '4px', background: C.bgNested, padding: '3px', borderRadius: RADIUS.md }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, padding: '6px 8px', display: 'flex', alignItems: 'center' }}>מיון:</span>
            {SORT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                style={{ padding: '5px 12px', borderRadius: RADIUS.sm, border: 'none', background: sortBy === opt.value ? C.bgCard : 'transparent', cursor: 'pointer', ...TEXT.xs, fontWeight: sortBy === opt.value ? WEIGHT.semibold : WEIGHT.normal, color: sortBy === opt.value ? C.textPrimary : C.textSecondary, boxShadow: sortBy === opt.value ? SHADOW.sm : 'none', transition: EASE.fast }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {testers.length === 0 && (
        <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted, background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '52px', marginBottom: SP[3] }}>👥</div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: SP[2] }}>אין בודקים עדיין</div>
          <div style={{ ...TEXT.sm, marginBottom: SP[5] }}>הוסף בודקים מתוך רשימת המשתמשים הקיימים</div>
          <button onClick={openAdd}
            style={{ background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '10px 24px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold }}>
            + הוסף בודק ראשון
          </button>
        </div>
      )}

      {/* ── Tester cards grid ── */}
      {displayed.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: SP[4] }}>
          {displayed.map(tester => {
            const s    = statsMap.get(tester.userId)!;
            const role = ROLE_META[tester.role] ?? ROLE_META.EMPLOYEE;
            const fillColor = s.completion >= 80 ? '#37C47A' : s.completion >= 50 ? '#4573D2' : s.completion >= 25 ? '#E8AF00' : '#F0883E';

            return (
              <div key={tester.userId}
                style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, boxShadow: SHADOW.sm, overflow: 'hidden', transition: EASE.fast }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = SHADOW.md)}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = SHADOW.sm)}>

                {/* ── Card header ── */}
                <div style={{ padding: `${SP[4]} ${SP[4]} ${SP[3]}`, display: 'flex', gap: SP[3], alignItems: 'flex-start' }}>
                  {/* Avatar */}
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: C.infoBg, border: `2px solid ${C.info}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: WEIGHT.bold, color: C.info, flexShrink: 0 }}>
                    {tester.fullName.charAt(0)}
                  </div>

                  {/* Name + email + badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...TEXT.base, fontWeight: WEIGHT.bold, marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tester.fullName}
                    </div>
                    <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tester.email}
                    </div>
                    <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: role.color, background: role.bg, padding: '2px 8px', borderRadius: RADIUS.full }}>
                      {role.label}
                    </span>
                  </div>

                  {/* Remove button */}
                  <button onClick={() => removeTester(tester)} title="הסר בודק"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDisabled, fontSize: '15px', padding: '4px', borderRadius: RADIUS.sm, transition: EASE.fast, flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.background = C.dangerBg; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.textDisabled; e.currentTarget.style.background = 'none'; }}>
                    ✕
                  </button>
                </div>

                {/* ── Stats bar ── */}
                <div style={{ borderTop: `1px solid ${C.border}`, padding: `${SP[3]} ${SP[4]}` }}>
                  {/* Overall score + completion */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[2] }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
                      <span style={{ ...TEXT.xs, color: C.textMuted }}>{s.totalRated}/{s.totalSkills} סקילים דורגו</span>
                      <span style={{ ...TEXT.xs, color: fillColor, fontWeight: WEIGHT.semibold }}>{s.completion}%</span>
                    </div>
                    {s.overallAvg !== null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ ...TEXT.xs, color: C.textMuted }}>ממוצע</span>
                        <span style={{ fontWeight: WEIGHT.bold, fontSize: '17px', color: avgColor(s.overallAvg), background: `${avgColor(s.overallAvg)}18`, padding: '2px 9px', borderRadius: RADIUS.full }}>
                          {s.overallAvg.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: '6px', background: C.bgHover, borderRadius: '99px', overflow: 'hidden', marginBottom: SP[3] }}>
                    <div style={{ height: '100%', width: `${s.completion}%`, background: fillColor, borderRadius: '99px', transition: EASE.standard }} />
                  </div>

                  {/* Category mini scores */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {CATEGORIES.map(cat => {
                      const m   = CAT_META[cat];
                      const avg = s.catAvgs[cat];
                      const catTotal  = skills.filter(sk => sk.type === cat).length;
                      const catRated  = skills.filter(sk => sk.type === cat && (tester.skills.find(ts => ts.skillId === sk.id)?.level ?? 0) > 0).length;
                      return (
                        <div key={cat} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${C.border}` }}>
                          <div>
                            <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: m.color }}>{m.label}</div>
                            <div style={{ ...TEXT.xs, color: C.textDisabled }}>{catRated}/{catTotal}</div>
                          </div>
                          {avg !== null
                            ? <span style={{ fontWeight: WEIGHT.bold, fontSize: '16px', color: avgColor(avg) }}>{avg.toFixed(1)}</span>
                            : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
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
        <div style={{ textAlign: 'center', padding: SP[8], color: C.textMuted, ...TEXT.sm }}>
          לא נמצאו בודקים התואמים לחיפוש
        </div>
      )}

      {/* ── Add Tester Modal ── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], width: '420px', maxWidth: '94vw', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold }}>הוספת בודק</span>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>סנן לפי צוות</label>
              <select value={filterTeamId} onChange={e => { setFilterTeamId(e.target.value); loadAvailable(e.target.value); }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, fontFamily: FONT, ...TEXT.sm, marginBottom: SP[4], outline: 'none', background: C.bgCard, color: C.textPrimary }}>
                <option value="">כל הצוותים</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              {availableUsers.length === 0 ? (
                <>
                  <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[4], background: C.bgNested, borderRadius: RADIUS.md, marginBottom: SP[4] }}>
                    {filterTeamId ? 'כל חברי הצוות כבר רשומים כבודקים' : 'כל המשתמשים הפעילים כבר רשומים כבודקים'}
                  </div>
                  <button onClick={() => setShowAdd(false)} style={{ width: '100%', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
                    סגור
                  </button>
                </>
              ) : (
                <>
                  <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>בחר עובד</label>
                  <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, fontFamily: FONT, ...TEXT.sm, marginBottom: SP[5], outline: 'none', background: C.bgCard, color: C.textPrimary }}>
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: SP[2] }}>
                    <button onClick={addTester} disabled={!selectedUserId || savingAdd}
                      style={{ flex: 1, background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: savingAdd ? 0.5 : 1 }}>
                      {savingAdd ? 'מוסיף...' : 'הוסף בודק'}
                    </button>
                    <button onClick={() => setShowAdd(false)} style={{ flex: 1, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
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
