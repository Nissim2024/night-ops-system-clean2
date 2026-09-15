import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { Select } from '../ui';
import { useDialog } from '../../context/DialogContext';

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
  const dialog = useDialog();
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

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ stats: { testersCreated: number; cellsUpdated: number; rowsSkipped: number }; warnings: string[] } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
      dialog.alert(e.response?.data?.message ?? 'שגיאה בשמירה', 'שגיאה', 'danger');
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
      dialog.alert(e.response?.data?.message ?? 'שגיאה בהוספה', 'שגיאה', 'danger');
    } finally {
      setSavingSkill(false);
    }
  };

  const deleteSkill = async (skill: Skill) => {
    if (!await dialog.confirm(`למחוק את הסקיל "${skill.name}"? הנתונים של כל הבודקים יאבדו.`, 'מחיקת סקיל', 'danger')) return;
    try {
      await axios.delete(`${API}/qa/skills/${skill.id}`, hdrs);
      flash(`סקיל "${skill.name}" נמחק`);
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה במחיקה', 'שגיאה', 'danger');
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
      dialog.alert(e.response?.data?.message ?? 'שגיאה בהוספה', 'שגיאה', 'danger');
    } finally {
      setSavingTester(false);
    }
  };

  const removeTester = async (tester: Tester) => {
    if (!await dialog.confirm(`להסיר את ${tester.fullName} מרשימת הבודקים?`, 'הסרת בודק', 'danger')) return;
    try {
      await axios.delete(`${API}/qa/testers/${tester.userId}`, hdrs);
      flash(`${tester.fullName} הוסר`);
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה בהסרה', 'שגיאה', 'danger');
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${API}/qa/matrix/import`, formData, {
        headers: { ...hdrs.headers, 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      flash('הייבוא הושלם');
      load();
    } catch (e: any) {
      dialog.alert(e.response?.data?.message ?? 'שגיאה בייבוא הקובץ', 'שגיאה', 'danger');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    <td className="py-2 px-3 border-b border-border sticky start-0 z-[1] min-w-[220px]" style={{ background: rowBg }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: C.infoBg, border: `1px solid ${C.info}33`, color: C.info }}>
            {tester.fullName.charAt(0)}
          </div>
          <div>
            <div className="text-sm font-semibold whitespace-nowrap">{tester.fullName}</div>
            <div className="text-xs text-subtle-foreground whitespace-nowrap">{tester.email}</div>
          </div>
        </div>
        <button onClick={() => removeTester(tester)} title="הסר בודק"
          className="bg-transparent border-none cursor-pointer text-sm py-[3px] px-[5px] rounded-sm transition-colors duration-fast ease-out shrink-0"
          style={{ color: C.textDisabled }}
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
      <td className={cn('p-1 text-center border-b border-border relative min-w-[60px]', si < total - 1 && 'border-e border-border')}>
        {isEdit ? (
          <div className="flex flex-col gap-0.5 items-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-card border border-border rounded-lg p-1.5 shadow-lg">
            {[0,1,2,3,4,5].map(l => (
              <button key={l} disabled={isSaving}
                onClick={() => saveLevel(tester.userId, skill.id, l)}
                className="w-9 h-6 rounded-sm border-none cursor-pointer text-xs font-bold transition-opacity duration-fast ease-out"
                style={{ background: l === 0 ? C.bgNested : LEVEL_BG[l], color: l === 0 ? C.textMuted : LEVEL_COLOR[l], opacity: isSaving ? 0.5 : 1 }}>
                {l === 0 ? '—' : l}
              </button>
            ))}
            {/* N/R separator + button */}
            <div className="w-full h-px bg-border my-0.5" />
            <button disabled={isSaving}
              onClick={() => saveLevel(tester.userId, skill.id, -1)}
              title="לא רלוונטי — לא נכנס לחישוב הציון"
              className="w-9 h-6 rounded-sm cursor-pointer text-[11px] font-bold transition-opacity duration-fast ease-out border"
              style={{ borderColor: `${NR_COLOR}55`, background: level === -1 ? NR_BG : 'transparent', color: NR_COLOR, opacity: isSaving ? 0.5 : 1 }}>
              N/R
            </button>
          </div>
        ) : (
          <button onClick={() => setEditCell({ userId: tester.userId, skillId: skill.id })}
            className={cn('w-10 h-[30px] rounded-sm cursor-pointer text-xs font-bold transition-colors duration-fast ease-out', isNR ? 'border' : 'border-none')}
            style={{
              borderColor: isNR ? `${NR_COLOR}44` : undefined,
              background: isNR ? NR_BG : level > 0 ? LEVEL_BG[level] : 'transparent',
              color: isNR ? NR_COLOR : level > 0 ? LEVEL_COLOR[level] : C.textDisabled,
            }}
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

  if (loading) return <div className="text-center p-10 text-subtle-foreground text-sm">טוען מטריצה...</div>;
  if (error)   return <div className="bg-danger-bg border border-danger/[26.7%] rounded-lg p-4 text-danger text-sm">{error}</div>;

  return (
    <div className="text-foreground">

      {/* ── Toast ── */}
      {successMsg && (
        <div className="fixed top-[70px] left-1/2 -translate-x-1/2 z-[9999] bg-success text-white py-2.5 px-5 rounded-lg text-sm font-semibold shadow-md">
          ✓ {successMsg}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xl font-bold flex items-center gap-2">
            <span>🧠</span> מטריצת סקילים
          </div>
          <div className="text-sm text-subtle-foreground mt-0.5">
            {testers.length} בודקים · {skills.length} סקילים · משקל כולל {skills.reduce((s, sk) => s + sk.weight, 0)}
          </div>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className={cn('bg-muted text-muted-foreground border border-border rounded-md py-[7px] px-3.5 text-sm font-semibold transition-opacity duration-fast ease-out', importing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100')}>
            {importing ? '⏳ מייבא...' : '📥 ייבוא Excel'}
          </button>
          <button onClick={openAddTester}
            className="bg-info-bg text-info border border-info/20 rounded-md py-[7px] px-3.5 cursor-pointer text-sm font-semibold transition-colors duration-fast ease-out"
            onMouseEnter={e => e.currentTarget.style.background = C.info + '22'}
            onMouseLeave={e => e.currentTarget.style.background = C.infoBg}>
            + בודק
          </button>
          <button onClick={() => setShowAddSkill(true)}
            className="bg-primary text-white border-none rounded-md py-[7px] px-3.5 cursor-pointer text-sm font-semibold transition-[filter] duration-fast ease-out"
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}>
            + סקיל
          </button>
        </div>
      </div>

      {/* ── Import result ── */}
      {importResult && (
        <div className="bg-card border border-border rounded-lg py-3.5 px-[18px] mb-4">
          <div className={cn('flex items-center gap-3', importResult.warnings.length > 0 ? 'mb-2' : 'mb-0')}>
            <span className="text-sm font-bold text-foreground">📥 תוצאות ייבוא:</span>
            <span className="text-xs text-success">{importResult.stats.cellsUpdated} רמות עודכנו</span>
            {importResult.stats.testersCreated > 0 && <span className="text-xs text-info">{importResult.stats.testersCreated} בודקים חדשים</span>}
            {importResult.stats.rowsSkipped > 0 && <span className="text-xs text-warning">{importResult.stats.rowsSkipped} שורות דולגו</span>}
            <button onClick={() => setImportResult(null)} className="ms-auto bg-transparent border-none cursor-pointer text-subtle-foreground text-[15px]">✕</button>
          </div>
          {importResult.warnings.length > 0 && (
            <div className="max-h-[140px] overflow-y-auto flex flex-col gap-[3px]">
              {importResult.warnings.map((w, i) => (
                <div key={i} className="text-xs text-subtle-foreground">⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── View toggle ── */}
      <div className="flex gap-1 mb-4 bg-muted p-1 rounded-lg w-fit">
        {([['summary', 'תצוגת סיכום', '📊'], ['matrix', 'מטריצה מפורטת', '🔢']] as const).map(([mode, label, icon]) => (
          <button key={mode} onClick={() => setViewMode(mode as any)}
            className={cn('py-[7px] px-4 rounded-md border-none cursor-pointer text-sm transition-shadow duration-fast ease-out', viewMode === mode ? 'bg-card font-semibold text-foreground shadow-sm' : 'bg-transparent font-normal text-muted-foreground shadow-none')}>
            {icon} {label}
          </button>
        ))}
      </div>

      {testers.length === 0 && skills.length === 0 && (
        <div className="text-center p-10 text-subtle-foreground bg-card rounded-2xl border border-border">
          <div className="text-5xl mb-3">🧠</div>
          <div className="text-lg font-semibold mb-2">המטריצה ריקה</div>
          <div className="text-sm">הוסף בודקים וסקילים כדי להתחיל</div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          SUMMARY VIEW
      ══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'summary' && testers.length > 0 && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <table className="border-collapse w-full">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="py-3 px-4 text-right text-xs font-bold text-subtle-foreground uppercase tracking-wider min-w-[220px]">בודק</th>
                {CATEGORY_ORDER.map(cat => {
                  const m = SKILL_TYPE_META[cat];
                  const count = catSkillsMap[cat].length;
                  return (
                    <th key={cat} className="py-3 px-3 text-center min-w-[130px]">
                      <button onClick={() => { setActiveCategory(cat); setViewMode('matrix'); }}
                        className="rounded-lg py-[5px] px-3 cursor-pointer transition-opacity duration-fast ease-out flex flex-col items-center gap-0.5 w-full"
                        style={{ background: m.bg, border: `1px solid ${m.color}44` }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                        title="לחץ לפרטים">
                        <span className="text-xs font-bold" style={{ color: m.color }}>{m.label}</span>
                        <span className="text-xs opacity-75" style={{ color: m.color }}>{count} סקילים</span>
                      </button>
                    </th>
                  );
                })}
                <th className="py-3 px-3 text-center min-w-[80px] text-xs font-bold text-subtle-foreground">סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {testers.map((tester, ti) => {
                const rowBg = ti % 2 === 0 ? C.bgCard : C.bgNested;
                const catAvgs = CATEGORY_ORDER.map(cat => calcWeightedAvg(tester, catSkillsMap[cat]));
                const allRated = catAvgs.filter(a => a !== null) as number[];
                const totalAvg = allRated.length > 0 ? allRated.reduce((a, b) => a + b, 0) / allRated.length : null;
                return (
                  <tr key={tester.userId} className={ti % 2 === 0 ? 'bg-card' : 'bg-muted'}>
                    <TesterCell tester={tester} rowBg={rowBg} />
                    {CATEGORY_ORDER.map((cat, ci) => {
                      const avg = catAvgs[ci];
                      const m   = SKILL_TYPE_META[cat];
                      return (
                        <td key={cat} className="py-3 text-center border-b border-s border-border">
                          {avg !== null ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="font-bold py-[3px] px-2.5 rounded-full text-base" style={{ color: avgColor(avg), background: avgBg(avg) }}>
                                {avg.toFixed(1)}
                              </span>
                              {/* Mini bar */}
                              <div className="w-20 h-[5px] bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-base ease-out" style={{ width: `${(avg / 5) * 100}%`, background: avgColor(avg) }} />
                              </div>
                              {/* Per-skill fill rate (N/R excluded from denominator) */}
                              {(() => {
                                const catSk  = catSkillsMap[cat];
                                const nrCount = catSk.filter(sk => getLevel(tester, sk.id) === -1).length;
                                const rated   = catSk.filter(sk => getLevel(tester, sk.id) > 0).length;
                                const denom   = catSk.length - nrCount;
                                return (
                                  <span className="text-xs text-subtle-foreground">
                                    {rated}/{denom} סקילים{nrCount > 0 && <span style={{ color: NR_COLOR }}> ·{nrCount}N/R</span>}
                                  </span>
                                );
                              })()}
                              <button onClick={() => { setActiveCategory(cat); setViewMode('matrix'); }}
                                className="text-xs rounded-sm py-0.5 px-2 cursor-pointer font-semibold"
                                style={{ color: m.color, background: m.bg, border: `1px solid ${m.color}33` }}>
                                פרטים
                              </button>
                            </div>
                          ) : (
                            <span className="text-sm text-subtle-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Total avg */}
                    <td className="py-3 text-center border-b border-border">
                      {totalAvg !== null ? (
                        <span className="text-sm font-bold py-1 px-2.5 rounded-full" style={{ color: avgColor(totalAvg), background: avgBg(totalAvg) }}>
                          {totalAvg.toFixed(1)}
                        </span>
                      ) : <span className="text-subtle-foreground">—</span>}
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
        <div className="flex gap-2 mb-3 p-1 bg-muted rounded-xl">
          {CATEGORY_ORDER.map(cat => {
            const m     = SKILL_TYPE_META[cat];
            const count = catSkillsMap[cat].length;
            const isAct = activeCategory === cat;
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="flex-1 py-2.5 px-2 rounded-lg cursor-pointer transition-colors duration-fast ease-out flex flex-col items-center gap-[3px] border-2"
                style={{ borderColor: isAct ? m.color : 'transparent', background: isAct ? m.bg : 'transparent' }}>
                <span className={cn('text-sm', isAct ? 'font-bold' : 'font-normal')} style={{ color: isAct ? m.color : C.textSecondary }}>{m.label}</span>
                <span className="text-xs" style={{ color: isAct ? m.color : C.textDisabled }}>{count} סקילים · משקל {catSkillsMap[cat].reduce((s, sk) => s + sk.weight, 0)}</span>
              </button>
            );
          })}
        </div>

        {/* Level legend */}
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          {([1,2,3,4,5] as const).map(l => (
            <div key={l} className="flex items-center gap-[5px]">
              <div className="w-[22px] h-[22px] rounded-sm flex items-center justify-center text-xs font-bold" style={{ background: LEVEL_BG[l], border: `1px solid ${LEVEL_COLOR[l]}44`, color: LEVEL_COLOR[l] }}>{l}</div>
              <span className="text-xs text-subtle-foreground">{LEVEL_LABEL[l].split(' — ')[1]}</span>
            </div>
          ))}
          <div className="flex items-center gap-[5px] ms-2 ps-2 border-s border-border">
            <div className="w-[22px] h-[22px] rounded-sm flex items-center justify-center text-[11px] font-bold" style={{ background: NR_BG, border: `1px solid ${NR_COLOR}44`, color: NR_COLOR }}>N/R</div>
            <span className="text-xs text-subtle-foreground">לא רלוונטי — לא נכנס לחישוב</span>
          </div>
        </div>

        {/* Matrix table */}
        <div className="overflow-x-auto bg-card rounded-2xl border border-border shadow-sm">
          <table className="border-collapse w-full" style={{ minWidth: `${220 + activeSkills.length * 72 + 70}px` }}>
            <thead>
              <tr className="bg-muted" style={{ borderBottom: `2px solid ${activeMeta.color}44` }}>
                {/* Tester col header — sticky */}
                <th className="py-3 px-3 text-right sticky start-0 bg-muted z-[2] border-e border-border">
                  <span className="text-xs font-bold text-subtle-foreground uppercase tracking-wider">בודק</span>
                </th>
                {/* Skill headers */}
                {activeSkills.map((skill, si) => (
                  <th key={skill.id}
                    className="py-2 px-1.5 text-center align-bottom border-e border-border min-w-[72px] max-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs text-muted-foreground font-medium leading-[1.3] max-w-[88px] line-clamp-2 text-center break-words" title={skill.name}>
                        {skill.name}
                      </span>
                      <div className="flex gap-1 items-center">
                        <span title="משקל" className="text-[12px] font-bold py-px px-[5px] rounded-xs" style={{ color: activeMeta.color, background: activeMeta.bg }}>
                          {skill.weight}
                        </span>
                        <button onClick={() => deleteSkill(skill)} title="מחק סקיל"
                          className="bg-transparent border-none cursor-pointer text-[12px] p-px leading-none transition-colors duration-fast ease-out"
                          style={{ color: C.textDisabled }}
                          onMouseEnter={e => e.currentTarget.style.color = C.danger}
                          onMouseLeave={e => e.currentTarget.style.color = C.textDisabled}>✕</button>
                      </div>
                    </div>
                  </th>
                ))}
                {/* Avg header */}
                <th className="py-2 px-3 text-center min-w-[72px]" style={{ borderInlineStart: `2px solid ${activeMeta.color}44` }}>
                  <span className="text-xs font-bold" style={{ color: activeMeta.color }}>ממוצע<br/>משוקלל</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {testers.map((tester, ti) => {
                const rowBg = ti % 2 === 0 ? C.bgCard : C.bgNested;
                const avg   = calcWeightedAvg(tester, activeSkills);
                return (
                  <tr key={tester.userId} className={ti % 2 === 0 ? 'bg-card' : 'bg-muted'}>
                    <TesterCell tester={tester} rowBg={rowBg} />
                    {activeSkills.map((skill, si) => (
                      <SkillLevelCell key={skill.id} tester={tester} skill={skill} si={si} total={activeSkills.length} />
                    ))}
                    {/* Avg cell */}
                    <td className="p-2 text-center border-b border-border" style={{ borderInlineStart: `2px solid ${activeMeta.color}44` }}>
                      {avg !== null ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm font-bold py-[3px] px-2.5 rounded-full" style={{ color: avgColor(avg), background: avgBg(avg) }}>
                            {avg.toFixed(1)}
                          </span>
                          <div className="w-[50px] h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(avg / 5) * 100}%`, background: avgColor(avg) }} />
                          </div>
                        </div>
                      ) : <span className="text-subtle-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Category average row */}
            <tfoot>
              <tr className="bg-muted" style={{ borderTop: `2px solid ${activeMeta.color}44` }}>
                <td className="py-2 px-3 sticky start-0 bg-muted z-[1] border-e border-border">
                  <span className="text-xs font-bold text-subtle-foreground">ממוצע קבוצה</span>
                </td>
                {activeSkills.map((skill, si) => {
                  const levels = testers.map(t => getLevel(t, skill.id)).filter(l => l > 0);
                  const avg = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : null;
                  return (
                    <td key={skill.id} className="p-2 text-center border-e border-border">
                      {avg !== null
                        ? <span className="text-xs font-semibold" style={{ color: avgColor(avg) }}>{avg.toFixed(1)}</span>
                        : <span className="text-xs text-subtle-foreground">—</span>}
                    </td>
                  );
                })}
                <td style={{ borderInlineStart: `2px solid ${activeMeta.color}44` }} />
              </tr>
            </tfoot>
          </table>
        </div>
      </>)}

      {/* ── Click outside to close cell editor ── */}
      {editCell && (
        <div className="fixed inset-0 z-[99]" onClick={() => setEditCell(null)} />
      )}

      {/* ── Add Skill Modal ── */}
      {showAddSkill && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center" style={{ background: C.bgOverlay }}
          onClick={e => { if (e.target === e.currentTarget) { setShowAddSkill(false); setNewSkillName(''); } }}>
          <div className="bg-card rounded-3xl w-[400px] max-w-[94vw] overflow-hidden" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
            <div className="py-4 px-5 border-b border-border flex items-center justify-between">
              <span className="text-lg font-bold">הוספת סקיל חדש</span>
              <button onClick={() => { setShowAddSkill(false); setNewSkillName(''); }} className="bg-transparent border-none cursor-pointer text-subtle-foreground text-lg">✕</button>
            </div>
            <div className="p-5">
              <label className="block text-sm font-semibold mb-2">שם הסקיל</label>
              <input
                value={newSkillName}
                onChange={e => setNewSkillName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSkill()}
                placeholder="לדוגמה: Selenium, SQL, Agile..."
                autoFocus
                className="w-full rounded-md border border-border py-2 px-3 text-sm outline-none mb-4"
                onFocus={e => e.currentTarget.style.borderColor = C.borderFocus}
                onBlur={e => e.currentTarget.style.borderColor = C.border}
              />
              <label className="block text-sm font-semibold mb-2">קטגוריה</label>
              <div className="flex gap-2 flex-wrap mb-4">
                {(['Professional', 'Applications', 'Tools', 'Personal', 'Business'] as const).map(t => {
                  const meta = SKILL_TYPE_META[t];
                  const isActive = newSkillType === t;
                  return (
                    <button key={t} onClick={() => setNewSkillType(t)}
                      className={cn('py-[7px] px-3 rounded-md cursor-pointer text-xs transition-colors duration-fast ease-out border', isActive ? 'font-bold' : 'font-normal')}
                      style={{ borderColor: isActive ? meta.color : C.border, background: isActive ? meta.bg : C.bgNested, color: isActive ? meta.color : C.textSecondary }}>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <label className="block text-sm font-semibold mb-2">משקל (1–5)</label>
              <div className="flex gap-2 mb-5">
                {[1,2,3,4,5].map(w => (
                  <button key={w} onClick={() => setNewSkillWeight(w)}
                    className={cn('flex-1 py-[7px] rounded-md cursor-pointer text-sm transition-colors duration-fast ease-out border', newSkillWeight === w ? 'font-bold' : 'font-normal')}
                    style={{ borderColor: newSkillWeight === w ? C.brand : C.border, background: newSkillWeight === w ? `${C.brand}18` : C.bgNested, color: newSkillWeight === w ? C.brand : C.textSecondary }}>
                    {w}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={addSkill} disabled={!newSkillName.trim() || savingSkill}
                  className={cn('flex-1 bg-primary text-white border-none rounded-md py-2.5 cursor-pointer text-sm font-semibold transition-opacity duration-fast ease-out', (!newSkillName.trim() || savingSkill) ? 'opacity-50' : 'opacity-100')}>
                  {savingSkill ? 'שומר...' : 'הוסף'}
                </button>
                <button onClick={() => { setShowAddSkill(false); setNewSkillName(''); }}
                  className="flex-1 bg-muted border border-border rounded-md py-2.5 cursor-pointer text-sm text-muted-foreground">
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Tester Modal ── */}
      {showAddTester && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center" style={{ background: C.bgOverlay }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddTester(false); }}>
          <div className="bg-card rounded-3xl w-[400px] max-w-[94vw] overflow-hidden" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
            <div className="py-4 px-5 border-b border-border flex items-center justify-between">
              <span className="text-lg font-bold">הוספת בודק</span>
              <button onClick={() => setShowAddTester(false)} className="bg-transparent border-none cursor-pointer text-subtle-foreground text-lg">✕</button>
            </div>
            <div className="p-5">
              {/* Team filter */}
              <label className="block text-sm font-semibold mb-2">סנן לפי צוות</label>
              <Select value={filterTeamId} onChange={e => handleTeamFilterChange(e.target.value)} fullWidth className="mb-4">
                <option value="">כל הצוותים</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>

              {availableUsers.length === 0
                ? <>
                    <div className="text-sm text-subtle-foreground text-center p-4 bg-muted rounded-md mb-4">
                      {filterTeamId ? 'כל חברי הצוות כבר רשומים כבודקים' : 'כל המשתמשים הפעילים כבר רשומים כבודקים'}
                    </div>
                    <button onClick={() => setShowAddTester(false)}
                      className="w-full bg-muted border border-border rounded-md py-2.5 cursor-pointer text-sm text-muted-foreground">
                      סגור
                    </button>
                  </>
                : (<>
                  <label className="block text-sm font-semibold mb-2">בחר עובד</label>
                  <Select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} fullWidth className="mb-5">
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                  </Select>
                  <div className="flex gap-2">
                    <button onClick={addTester} disabled={!selectedUserId || savingTester}
                      className={cn('flex-1 bg-info text-white border-none rounded-md py-2.5 cursor-pointer text-sm font-semibold transition-opacity duration-fast ease-out', savingTester ? 'opacity-50' : 'opacity-100')}>
                      {savingTester ? 'מוסיף...' : 'הוסף בודק'}
                    </button>
                    <button onClick={() => setShowAddTester(false)}
                      className="flex-1 bg-muted border border-border rounded-md py-2.5 cursor-pointer text-sm text-muted-foreground">
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
