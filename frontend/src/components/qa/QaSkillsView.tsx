import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  name: string;
  type: 'Professional' | 'Applications' | 'Tools' | 'Personal' | 'Business';
  weight: number;
}

interface TesterSkillEntry {
  skillId:   string;
  skillName: string;
  skillType: string;
  level:     number;
}

interface Tester {
  userId:   string;
  fullName: string;
  email:    string;
  skills:   TesterSkillEntry[];
}

interface AvailableUser {
  id: string; fullName: string; email: string;
}

interface Team {
  id: string; name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SKILL_TYPE_META = {
  Professional: { label: 'מקצועיות',         color: '#4573D2', bg: 'rgba(69,115,210,0.10)' },
  Applications: { label: 'מערכות',           color: '#37C47A', bg: 'rgba(55,196,122,0.10)' },
  Tools:        { label: 'כלים',             color: '#F0883E', bg: 'rgba(240,136,62,0.10)'  },
  Personal:     { label: 'אישי',             color: '#9C6ADE', bg: 'rgba(156,106,222,0.10)' },
  Business:     { label: 'תהליכים עסקיים',  color: '#0891b2', bg: 'rgba(8,145,178,0.10)'   },
} as const;

const LEVEL_COLOR = ['', '#E8AF00', '#F0883E', '#4573D2', '#9C6ADE', '#37C47A'];
const LEVEL_BG    = ['', 'rgba(232,175,0,0.12)', 'rgba(240,136,62,0.12)', 'rgba(69,115,210,0.10)', 'rgba(156,106,222,0.10)', 'rgba(55,196,122,0.10)'];
const LEVEL_LABEL = ['—', '1 — מתחיל', '2 — בסיסי', '3 — בינוני', '4 — מתקדם', '5 — מומחה'];

const NR_COLOR = '#94a3b8';
const NR_BG    = 'rgba(148,163,184,0.12)';

interface Props { token: string; }

// ── Component ─────────────────────────────────────────────────────────────────

export const QaSkillsView: React.FC<Props> = ({ token }) => {
  const hdrs = { headers: { Authorization: `Bearer ${token}` } };

  const [testers, setTesters]   = useState<Tester[]>([]);
  const [skills,  setSkills]    = useState<Skill[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);

  const [editCell,   setEditCell]   = useState<{ userId: string; skillId: string } | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const [showAddSkill,  setShowAddSkill]  = useState(false);
  const [newSkillName,  setNewSkillName]  = useState('');
  const [newSkillType,  setNewSkillType]  = useState<'Professional' | 'Applications' | 'Tools' | 'Personal' | 'Business'>('Professional');
  const [newSkillWeight, setNewSkillWeight] = useState<number>(3);
  const [savingSkill,   setSavingSkill]   = useState(false);

  const [showAddTester,    setShowAddTester]    = useState(false);
  const [availableUsers,   setAvailableUsers]   = useState<AvailableUser[]>([]);
  const [selectedUserId,   setSelectedUserId]   = useState('');
  const [savingTester,     setSavingTester]     = useState(false);
  const [teams,            setTeams]            = useState<Team[]>([]);
  const [filterTeamId,     setFilterTeamId]     = useState<string>('');

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  type CategoryKey = 'Professional' | 'Applications' | 'Tools' | 'Personal' | 'Business';
  const CATEGORY_ORDER: CategoryKey[] = ['Professional', 'Applications', 'Tools', 'Personal', 'Business'];
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('Professional');
  const [viewMode, setViewMode] = useState<'summary' | 'matrix'>('summary');

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

  const getLevel = (tester: Tester, skillId: string): number =>
    tester.skills.find(s => s.skillId === skillId)?.level ?? 0;

  const saveLevel = async (userId: string, skillId: string, level: number) => {
    const key = `${userId}__${skillId}`;
    setSavingCell(key);
    try {
      if (level === 0) {
        await axios.delete(`${API}/qa/matrix/${userId}/${skillId}`, hdrs);
      } else {
        await axios.put(`${API}/qa/matrix/${userId}/${skillId}`, { level }, hdrs);
      }
      setTesters(prev => prev.map(t => {
        if (t.userId !== userId) return t;
        const withoutSkill = t.skills.filter(s => s.skillId !== skillId);
        if (level === 0) return { ...t, skills: withoutSkill };
        const skill = skills.find(s => s.id === skillId);
        return { ...t, skills: [...withoutSkill, { skillId, skillName: skill?.name ?? '', skillType: skill?.type ?? '', level }] };
      }));
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'שגיאה בשמירה');
    } finally {
      setSavingCell(null);
      setEditCell(null);
    }
  };

  const addSkill = async () => {
    if (!newSkillName.trim()) return;
    setSavingSkill(true);
    try {
      await axios.post(`${API}/qa/skills`, { name: newSkillName.trim(), type: newSkillType, weight: newSkillWeight }, hdrs);
      flash(`סקיל "${newSkillName}" נוסף`);
      setNewSkillName(''); setNewSkillWeight(3); setShowAddSkill(false);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'שגיאה בהוספה');
    } finally {
      setSavingSkill(false);
    }
  };

  const deleteSkill = async (skill: Skill) => {
    if (!window.confirm(`למחוק את הסקיל "${skill.name}"? הנתונים של כל הבודקים יאבדו.`)) return;
    try {
      await axios.delete(`${API}/qa/skills/${skill.id}`, hdrs);
      flash(`סקיל "${skill.name}" נמחק`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'שגיאה במחיקה');
    }
  };

  const loadAvailableUsers = async (teamId: string) => {
    const url = teamId
      ? `${API}/qa/users/available?teamId=${teamId}`
      : `${API}/qa/users/available`;
    const res = await axios.get(url, hdrs);
    setAvailableUsers(res.data);
    setSelectedUserId(res.data[0]?.id ?? '');
  };

  const openAddTester = async () => {
    setShowAddTester(true);
    const [teamsRes] = await Promise.all([
      axios.get(`${API}/teams`, hdrs),
    ]);
    const teamList: Team[] = teamsRes.data;
    setTeams(teamList);
    // default to QA team if exists, otherwise no filter
    const qaTeam = teamList.find(t => t.name.toLowerCase().includes('qa') || t.name.includes('בדיקות'));
    const defaultTeamId = qaTeam?.id ?? '';
    setFilterTeamId(defaultTeamId);
    await loadAvailableUsers(defaultTeamId);
  };

  const handleTeamFilterChange = async (teamId: string) => {
    setFilterTeamId(teamId);
    await loadAvailableUsers(teamId);
  };

  const addTester = async () => {
    if (!selectedUserId) return;
    setSavingTester(true);
    try {
      await axios.post(`${API}/qa/testers`, { userId: selectedUserId }, hdrs);
      const u = availableUsers.find(u => u.id === selectedUserId);
      flash(`${u?.fullName} נוסף כבודק`);
      setShowAddTester(false);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'שגיאה בהוספה');
    } finally {
      setSavingTester(false);
    }
  };

  const removeTester = async (tester: Tester) => {
    if (!window.confirm(`להסיר את ${tester.fullName} מרשימת הבודקים?`)) return;
    try {
      await axios.delete(`${API}/qa/testers/${tester.userId}`, hdrs);
      flash(`${tester.fullName} הוסר`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'שגיאה בהסרה');
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const catSkillsMap = Object.fromEntries(
    CATEGORY_ORDER.map(cat => [cat, skills.filter(s => s.type === cat)])
  ) as Record<CategoryKey, Skill[]>;

  const activeSkills = catSkillsMap[activeCategory] ?? [];
  const activeMeta   = SKILL_TYPE_META[activeCategory];

  const calcWeightedAvg = (tester: Tester, catSkills: Skill[]): number | null => {
    // level > 0: rated skills only (excludes 0=not-set and -1=N/R)
    const rated = catSkills.filter(sk => getLevel(tester, sk.id) > 0);
    if (rated.length === 0) return null;
    const sumWL = rated.reduce((acc, sk) => acc + getLevel(tester, sk.id) * sk.weight, 0);
    const sumW  = rated.reduce((acc, sk) => acc + sk.weight, 0);
    return sumWL / sumW;
  };

  const avgColor = (v: number | null) => {
    if (v === null) return C.textDisabled;
    if (v < 2) return '#F0883E';
    if (v < 3) return '#E8AF00';
    if (v < 4) return '#4573D2';
    return '#37C47A';
  };
  const avgBg = (v: number | null) => {
    if (v === null) return 'transparent';
    if (v < 2) return 'rgba(240,136,62,0.12)';
    if (v < 3) return 'rgba(232,175,0,0.12)';
    if (v < 4) return 'rgba(69,115,210,0.10)';
    return 'rgba(55,196,122,0.10)';
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const TesterCell = ({ tester, rowBg }: { tester: Tester; rowBg: string }) => (
    <td style={{ padding: `${SP[2]} ${SP[3]}`, borderBottom: `1px solid ${C.border}`, position: 'sticky', right: 0, background: rowBg, zIndex: 1, minWidth: '220px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[2] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: C.infoBg, border: `1px solid ${C.info}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.info, flexShrink: 0 }}>
            {tester.fullName.charAt(0)}
          </div>
          <div>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>{tester.fullName}</div>
            <div style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>{tester.email}</div>
          </div>
        </div>
        <button onClick={() => removeTester(tester)} title="הסר בודק"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDisabled, fontSize: '12px', padding: '3px 5px', borderRadius: RADIUS.sm, transition: EASE.fast, flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.background = C.dangerBg; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.textDisabled; e.currentTarget.style.background = 'none'; }}
        >✕</button>
      </div>
    </td>
  );

  const SkillLevelCell = ({ tester, skill, si, total }: { tester: Tester; skill: Skill; si: number; total: number }) => {
    const level    = getLevel(tester, skill.id);
    const cellKey  = `${tester.userId}__${skill.id}`;
    const isEdit   = editCell?.userId === tester.userId && editCell?.skillId === skill.id;
    const isSaving = savingCell === cellKey;
    const isNR     = level === -1;
    return (
      <td style={{ padding: '4px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderLeft: si < total - 1 ? `1px solid ${C.border}` : 'none', position: 'relative', minWidth: '60px' }}>
        {isEdit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 100, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '6px', boxShadow: SHADOW.lg }}>
            {[0,1,2,3,4,5].map(l => (
              <button key={l} disabled={isSaving}
                onClick={() => saveLevel(tester.userId, skill.id, l)}
                style={{ width: '36px', height: '24px', borderRadius: RADIUS.sm, border: 'none', background: l === 0 ? C.bgNested : LEVEL_BG[l], color: l === 0 ? C.textMuted : LEVEL_COLOR[l], cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.bold, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}>
                {l === 0 ? '—' : l}
              </button>
            ))}
            {/* N/R separator + button */}
            <div style={{ width: '100%', height: '1px', background: C.border, margin: '2px 0' }} />
            <button disabled={isSaving}
              onClick={() => saveLevel(tester.userId, skill.id, -1)}
              title="לא רלוונטי — לא נכנס לחישוב הציון"
              style={{ width: '36px', height: '24px', borderRadius: RADIUS.sm, border: `1px solid ${NR_COLOR}55`, background: level === -1 ? NR_BG : 'transparent', color: NR_COLOR, cursor: 'pointer', fontSize: '9px', fontWeight: WEIGHT.bold, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}>
              N/R
            </button>
          </div>
        ) : (
          <button onClick={() => setEditCell({ userId: tester.userId, skillId: skill.id })}
            style={{ width: '40px', height: '30px', borderRadius: RADIUS.sm, border: isNR ? `1px solid ${NR_COLOR}44` : 'none', background: isNR ? NR_BG : level > 0 ? LEVEL_BG[level] : 'transparent', color: isNR ? NR_COLOR : level > 0 ? LEVEL_COLOR[level] : C.textDisabled, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.bold, transition: EASE.fast }}
            onMouseEnter={e => { if (level === 0) e.currentTarget.style.background = C.bgHover; }}
            onMouseLeave={e => { if (level === 0) e.currentTarget.style.background = 'transparent'; }}
            title={isNR ? 'לא רלוונטי — לחץ לשינוי' : level > 0 ? LEVEL_LABEL[level] : 'הגדר רמה'}>
            {isSaving ? '…' : isNR ? 'N/R' : level > 0 ? level : '+'}
          </button>
        )}
      </td>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted, ...TEXT.sm }}>טוען מטריצה...</div>;
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
            <span>🧠</span> מטריצת סקילים
          </div>
          <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: '2px' }}>
            {testers.length} בודקים · {skills.length} סקילים · משקל כולל {skills.reduce((s, sk) => s + sk.weight, 0)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: SP[2] }}>
          <button onClick={openAddTester}
            style={{ background: C.infoBg, color: C.info, border: `1px solid ${C.info}33`, borderRadius: RADIUS.md, padding: '7px 14px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, transition: EASE.fast }}
            onMouseEnter={e => e.currentTarget.style.background = C.info + '22'}
            onMouseLeave={e => e.currentTarget.style.background = C.infoBg}>
            + בודק
          </button>
          <button onClick={() => setShowAddSkill(true)}
            style={{ background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '7px 14px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, transition: EASE.fast }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}>
            + סקיל
          </button>
        </div>
      </div>

      {/* ── View toggle ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: SP[4], background: C.bgNested, padding: '4px', borderRadius: RADIUS.lg, width: 'fit-content' }}>
        {([['summary', 'תצוגת סיכום', '📊'], ['matrix', 'מטריצה מפורטת', '🔢']] as const).map(([mode, label, icon]) => (
          <button key={mode} onClick={() => setViewMode(mode as any)}
            style={{ padding: '7px 16px', borderRadius: RADIUS.md, border: 'none', background: viewMode === mode ? C.bgCard : 'transparent', cursor: 'pointer', ...TEXT.sm, fontWeight: viewMode === mode ? WEIGHT.semibold : WEIGHT.normal, color: viewMode === mode ? C.textPrimary : C.textSecondary, boxShadow: viewMode === mode ? SHADOW.sm : 'none', transition: EASE.fast }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {testers.length === 0 && skills.length === 0 && (
        <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted, background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '48px', marginBottom: SP[3] }}>🧠</div>
          <div style={{ ...TEXT.lg, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>המטריצה ריקה</div>
          <div style={{ ...TEXT.sm }}>הוסף בודקים וסקילים כדי להתחיל</div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          SUMMARY VIEW
      ══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'summary' && testers.length > 0 && (
        <div style={{ background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, boxShadow: SHADOW.sm, overflow: 'hidden' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: C.bgNested, borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: `${SP[3]} ${SP[4]}`, textAlign: 'right', ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: '220px' }}>בודק</th>
                {CATEGORY_ORDER.map(cat => {
                  const m = SKILL_TYPE_META[cat];
                  const count = catSkillsMap[cat].length;
                  return (
                    <th key={cat} style={{ padding: `${SP[3]} ${SP[3]}`, textAlign: 'center', minWidth: '130px' }}>
                      <button onClick={() => { setActiveCategory(cat); setViewMode('matrix'); }}
                        style={{ background: m.bg, border: `1px solid ${m.color}44`, borderRadius: RADIUS.lg, padding: '5px 12px', cursor: 'pointer', transition: EASE.fast, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', width: '100%' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                        title="לחץ לפרטים">
                        <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: m.color }}>{m.label}</span>
                        <span style={{ ...TEXT.xs, color: m.color, opacity: 0.75 }}>{count} סקילים</span>
                      </button>
                    </th>
                  );
                })}
                <th style={{ padding: `${SP[3]} ${SP[3]}`, textAlign: 'center', minWidth: '80px', ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted }}>סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {testers.map((tester, ti) => {
                const rowBg = ti % 2 === 0 ? C.bgCard : C.bgNested;
                const catAvgs = CATEGORY_ORDER.map(cat => calcWeightedAvg(tester, catSkillsMap[cat]));
                const allRated = catAvgs.filter(a => a !== null) as number[];
                const totalAvg = allRated.length > 0 ? allRated.reduce((a, b) => a + b, 0) / allRated.length : null;
                return (
                  <tr key={tester.userId} style={{ background: rowBg }}>
                    <TesterCell tester={tester} rowBg={rowBg} />
                    {CATEGORY_ORDER.map((cat, ci) => {
                      const avg = catAvgs[ci];
                      const m   = SKILL_TYPE_META[cat];
                      return (
                        <td key={cat} style={{ padding: SP[3], textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
                          {avg !== null ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: WEIGHT.bold, color: avgColor(avg), background: avgBg(avg), padding: '3px 10px', borderRadius: RADIUS.full, fontSize: '15px' }}>
                                {avg.toFixed(1)}
                              </span>
                              {/* Mini bar */}
                              <div style={{ width: '80px', height: '5px', background: C.bgHover, borderRadius: '99px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${(avg / 5) * 100}%`, background: avgColor(avg), borderRadius: '99px', transition: EASE.standard }} />
                              </div>
                              {/* Per-skill fill rate (N/R excluded from denominator) */}
                              {(() => {
                                const catSk  = catSkillsMap[cat];
                                const nrCount = catSk.filter(sk => getLevel(tester, sk.id) === -1).length;
                                const rated   = catSk.filter(sk => getLevel(tester, sk.id) > 0).length;
                                const denom   = catSk.length - nrCount;
                                return (
                                  <span style={{ ...TEXT.xs, color: C.textDisabled }}>
                                    {rated}/{denom} סקילים{nrCount > 0 && <span style={{ color: NR_COLOR }}> ·{nrCount}N/R</span>}
                                  </span>
                                );
                              })()}
                              <button onClick={() => { setActiveCategory(cat); setViewMode('matrix'); }}
                                style={{ ...TEXT.xs, color: m.color, background: m.bg, border: `1px solid ${m.color}33`, borderRadius: RADIUS.sm, padding: '2px 8px', cursor: 'pointer', fontWeight: WEIGHT.semibold }}>
                                פרטים
                              </button>
                            </div>
                          ) : (
                            <span style={{ ...TEXT.sm, color: C.textDisabled }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Total avg */}
                    <td style={{ padding: SP[3], textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
                      {totalAvg !== null ? (
                        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: avgColor(totalAvg), background: avgBg(totalAvg), padding: '4px 10px', borderRadius: RADIUS.full }}>
                          {totalAvg.toFixed(1)}
                        </span>
                      ) : <span style={{ color: C.textDisabled }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          MATRIX VIEW (per category)
      ══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'matrix' && testers.length > 0 && skills.length > 0 && (<>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: SP[2], marginBottom: SP[3], padding: '4px', background: C.bgNested, borderRadius: RADIUS.xl }}>
          {CATEGORY_ORDER.map(cat => {
            const m     = SKILL_TYPE_META[cat];
            const count = catSkillsMap[cat].length;
            const isAct = activeCategory === cat;
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                style={{ flex: 1, padding: '9px 8px', borderRadius: RADIUS.lg, border: isAct ? `2px solid ${m.color}` : '2px solid transparent', background: isAct ? m.bg : 'transparent', cursor: 'pointer', transition: EASE.fast, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                <span style={{ ...TEXT.sm, fontWeight: isAct ? WEIGHT.bold : WEIGHT.normal, color: isAct ? m.color : C.textSecondary }}>{m.label}</span>
                <span style={{ ...TEXT.xs, color: isAct ? m.color : C.textDisabled }}>{count} סקילים · משקל {catSkillsMap[cat].reduce((s, sk) => s + sk.weight, 0)}</span>
              </button>
            );
          })}
        </div>

        {/* Level legend */}
        <div style={{ display: 'flex', gap: SP[3], marginBottom: SP[3], flexWrap: 'wrap', alignItems: 'center' }}>
          {([1,2,3,4,5] as const).map(l => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: RADIUS.sm, background: LEVEL_BG[l], border: `1px solid ${LEVEL_COLOR[l]}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...TEXT.xs, fontWeight: WEIGHT.bold, color: LEVEL_COLOR[l] }}>{l}</div>
              <span style={{ ...TEXT.xs, color: C.textMuted }}>{LEVEL_LABEL[l].split(' — ')[1]}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginRight: SP[2], paddingRight: SP[2], borderRight: `1px solid ${C.border}` }}>
            <div style={{ width: '22px', height: '22px', borderRadius: RADIUS.sm, background: NR_BG, border: `1px solid ${NR_COLOR}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: WEIGHT.bold, color: NR_COLOR }}>N/R</div>
            <span style={{ ...TEXT.xs, color: C.textMuted }}>לא רלוונטי — לא נכנס לחישוב</span>
          </div>
        </div>

        {/* Matrix table */}
        <div style={{ overflowX: 'auto', background: C.bgCard, borderRadius: RADIUS['2xl'], border: `1px solid ${C.border}`, boxShadow: SHADOW.sm }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${220 + activeSkills.length * 72 + 70}px` }}>
            <thead>
              <tr style={{ background: C.bgNested, borderBottom: `2px solid ${activeMeta.color}44` }}>
                {/* Tester col header — sticky */}
                <th style={{ padding: `${SP[3]} ${SP[3]}`, textAlign: 'right', position: 'sticky', right: 0, background: C.bgNested, zIndex: 2, borderLeft: `1px solid ${C.border}` }}>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>בודק</span>
                </th>
                {/* Skill headers */}
                {activeSkills.map((skill, si) => (
                  <th key={skill.id}
                    style={{ padding: `${SP[2]} 6px`, textAlign: 'center', verticalAlign: 'bottom', borderLeft: `1px solid ${C.border}`, minWidth: '72px', maxWidth: '100px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ ...TEXT.xs, color: C.textSecondary, fontWeight: WEIGHT.medium, lineHeight: 1.3, maxWidth: '88px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textAlign: 'center', wordBreak: 'break-word' as const }} title={skill.name}>
                        {skill.name}
                      </span>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span title="משקל" style={{ fontSize: '10px', color: activeMeta.color, background: activeMeta.bg, padding: '1px 5px', borderRadius: '4px', fontWeight: WEIGHT.bold }}>
                          {skill.weight}
                        </span>
                        <button onClick={() => deleteSkill(skill)} title="מחק סקיל"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDisabled, fontSize: '10px', padding: '1px', lineHeight: 1, transition: EASE.fast }}
                          onMouseEnter={e => e.currentTarget.style.color = C.danger}
                          onMouseLeave={e => e.currentTarget.style.color = C.textDisabled}>✕</button>
                      </div>
                    </div>
                  </th>
                ))}
                {/* Avg header */}
                <th style={{ padding: `${SP[2]} ${SP[3]}`, textAlign: 'center', borderRight: `2px solid ${activeMeta.color}44`, minWidth: '72px' }}>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: activeMeta.color }}>ממוצע<br/>משוקלל</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {testers.map((tester, ti) => {
                const rowBg = ti % 2 === 0 ? C.bgCard : C.bgNested;
                const avg   = calcWeightedAvg(tester, activeSkills);
                return (
                  <tr key={tester.userId} style={{ background: rowBg }}>
                    <TesterCell tester={tester} rowBg={rowBg} />
                    {activeSkills.map((skill, si) => (
                      <SkillLevelCell key={skill.id} tester={tester} skill={skill} si={si} total={activeSkills.length} />
                    ))}
                    {/* Avg cell */}
                    <td style={{ padding: SP[2], textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderRight: `2px solid ${activeMeta.color}44` }}>
                      {avg !== null ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: avgColor(avg), background: avgBg(avg), padding: '3px 10px', borderRadius: RADIUS.full }}>
                            {avg.toFixed(1)}
                          </span>
                          <div style={{ width: '50px', height: '4px', background: C.bgHover, borderRadius: '99px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${(avg / 5) * 100}%`, background: avgColor(avg), borderRadius: '99px' }} />
                          </div>
                        </div>
                      ) : <span style={{ color: C.textDisabled }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Category average row */}
            <tfoot>
              <tr style={{ background: C.bgNested, borderTop: `2px solid ${activeMeta.color}44` }}>
                <td style={{ padding: `${SP[2]} ${SP[3]}`, position: 'sticky', right: 0, background: C.bgNested, zIndex: 1, borderLeft: `1px solid ${C.border}` }}>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted }}>ממוצע קבוצה</span>
                </td>
                {activeSkills.map((skill, si) => {
                  const levels = testers.map(t => getLevel(t, skill.id)).filter(l => l > 0);
                  const avg = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : null;
                  return (
                    <td key={skill.id} style={{ padding: SP[2], textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>
                      {avg !== null
                        ? <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: avgColor(avg) }}>{avg.toFixed(1)}</span>
                        : <span style={{ color: C.textDisabled, ...TEXT.xs }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ borderRight: `2px solid ${activeMeta.color}44` }} />
              </tr>
            </tfoot>
          </table>
        </div>
      </>)}

      {/* ── Click outside to close cell editor ── */}
      {editCell && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setEditCell(null)} />
      )}

      {/* ── Add Skill Modal ── */}
      {showAddSkill && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowAddSkill(false); setNewSkillName(''); } }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], width: '400px', maxWidth: '94vw', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold }}>הוספת סקיל חדש</span>
              <button onClick={() => { setShowAddSkill(false); setNewSkillName(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>שם הסקיל</label>
              <input
                value={newSkillName}
                onChange={e => setNewSkillName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSkill()}
                placeholder="לדוגמה: Selenium, SQL, Agile..."
                autoFocus
                style={{ width: '100%', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, padding: '8px 12px', fontFamily: FONT, ...TEXT.sm, outline: 'none', boxSizing: 'border-box', marginBottom: SP[4] }}
                onFocus={e => e.currentTarget.style.borderColor = C.borderFocus}
                onBlur={e => e.currentTarget.style.borderColor = C.border}
              />
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>קטגוריה</label>
              <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap', marginBottom: SP[4] }}>
                {(['Professional', 'Applications', 'Tools', 'Personal', 'Business'] as const).map(t => {
                  const meta = SKILL_TYPE_META[t];
                  const isActive = newSkillType === t;
                  return (
                    <button key={t} onClick={() => setNewSkillType(t)}
                      style={{ padding: '7px 12px', borderRadius: RADIUS.md, border: `1px solid ${isActive ? meta.color : C.border}`, background: isActive ? meta.bg : C.bgNested, cursor: 'pointer', ...TEXT.xs, fontWeight: isActive ? WEIGHT.bold : WEIGHT.normal, color: isActive ? meta.color : C.textSecondary, transition: EASE.fast }}>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>משקל (1–5)</label>
              <div style={{ display: 'flex', gap: SP[2], marginBottom: SP[5] }}>
                {[1,2,3,4,5].map(w => (
                  <button key={w} onClick={() => setNewSkillWeight(w)}
                    style={{ flex: 1, padding: '7px', borderRadius: RADIUS.md, border: `1px solid ${newSkillWeight === w ? C.brand : C.border}`, background: newSkillWeight === w ? `${C.brand}18` : C.bgNested, cursor: 'pointer', ...TEXT.sm, fontWeight: newSkillWeight === w ? WEIGHT.bold : WEIGHT.normal, color: newSkillWeight === w ? C.brand : C.textSecondary, transition: EASE.fast }}>
                    {w}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: SP[2] }}>
                <button onClick={addSkill} disabled={!newSkillName.trim() || savingSkill}
                  style={{ flex: 1, background: C.brand, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: !newSkillName.trim() || savingSkill ? 0.5 : 1 }}>
                  {savingSkill ? 'שומר...' : 'הוסף'}
                </button>
                <button onClick={() => { setShowAddSkill(false); setNewSkillName(''); }}
                  style={{ flex: 1, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Tester Modal ── */}
      {showAddTester && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: C.bgOverlay, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddTester(false); }}>
          <div style={{ background: C.bgCard, borderRadius: RADIUS['3xl'], width: '400px', maxWidth: '94vw', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold }}>הוספת בודק</span>
              <button onClick={() => setShowAddTester(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              {/* Team filter */}
              <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>סנן לפי צוות</label>
              <select value={filterTeamId} onChange={e => handleTeamFilterChange(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, fontFamily: FONT, ...TEXT.sm, marginBottom: SP[4], outline: 'none', background: C.bgCard, color: C.textPrimary }}>
                <option value="">כל הצוותים</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              {availableUsers.length === 0
                ? <>
                    <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[4], background: C.bgNested, borderRadius: RADIUS.md, marginBottom: SP[4] }}>
                      {filterTeamId ? 'כל חברי הצוות כבר רשומים כבודקים' : 'כל המשתמשים הפעילים כבר רשומים כבודקים'}
                    </div>
                    <button onClick={() => setShowAddTester(false)}
                      style={{ width: '100%', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
                      סגור
                    </button>
                  </>
                : (<>
                  <label style={{ display: 'block', ...TEXT.sm, fontWeight: WEIGHT.semibold, marginBottom: SP[2] }}>בחר עובד</label>
                  <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, fontFamily: FONT, ...TEXT.sm, marginBottom: SP[5], outline: 'none', background: C.bgCard, color: C.textPrimary }}>
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: SP[2] }}>
                    <button onClick={addTester} disabled={!selectedUserId || savingTester}
                      style={{ flex: 1, background: C.info, color: C.textInverse, border: 'none', borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: savingTester ? 0.5 : 1 }}>
                      {savingTester ? 'מוסיף...' : 'הוסף בודק'}
                    </button>
                    <button onClick={() => setShowAddTester(false)}
                      style={{ flex: 1, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '9px', cursor: 'pointer', ...TEXT.sm, color: C.textSecondary }}>
                      ביטול
                    </button>
                  </div>
                </>)
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
