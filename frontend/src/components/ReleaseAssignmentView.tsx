import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, FONT_MONO, RADIUS, SHADOW } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_META: Record<number, { label: string; icon: string }> = {
  1: { label: 'בוקר לפני גרסה',   icon: '☀️' },
  2: { label: 'ליל הגרסה — HOTNET', icon: '🌙' },
  3: { label: 'ליל הגרסה — HOT',    icon: '🌅' },
  4: { label: 'בוקר שלאחר גרסה',  icon: '📅' },
};
const TEAM_PALETTE = ['#4573D2', '#9C6ADE', '#37C47A', '#E8AF00', '#F0883E', '#14B8A6', '#EC6BAD', '#6366F1'];
function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

interface Proposal {
  id: string; teamId: string; title: string; app?: string | null; actionType?: string | null;
  phase: number; subPhaseId?: string | null; crNumber?: string | null; crLabel?: string | null;
  reviewStatus: string; usedInTaskId?: string | null;
}
interface SubPhaseOpt { id: string; name: string; phaseOrderIndex: number }
interface Props { token: string; versionId: string; versionName: string; }

const selectStyle: React.CSSProperties = {
  fontSize: '12.5px', fontWeight: 600, padding: '6px 11px', borderRadius: RADIUS.full,
  border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textSecondary, cursor: 'pointer',
};

export const ReleaseAssignmentView: React.FC<Props> = ({ token, versionId, versionName }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [proposals, setProposals]     = useState<Proposal[]>([]);
  const [teams, setTeams]             = useState<{ id: string; name: string }[]>([]);
  const [subPhaseOpts, setSubPhaseOpts] = useState<SubPhaseOpt[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [converting, setConverting]   = useState(false);
  const [error, setError]             = useState('');

  const [fPhase, setFPhase]     = useState<string>('all');
  const [fSubPhase, setFSubPhase] = useState<string>('all');
  const [fCr, setFCr]           = useState<string>('all');
  const [fTeam, setFTeam]       = useState<string>('all');
  const [fSystem, setFSystem]   = useState<string>('all');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/task-proposals/version/${versionId}`, { headers }),
      axios.get(`${API}/teams`, { headers }),
      axios.get(`${API}/versions/${versionId}/sub-phases`, { headers }),
    ]).then(([pr, tr, spr]) => {
      setProposals((pr.data as Proposal[]).filter(p => p.reviewStatus === 'APPROVED'));
      setTeams((tr.data as any[]).filter(t => t.active));
      const opts: SubPhaseOpt[] = [];
      for (const phase of spr.data) {
        for (const sp of phase.subPhases) opts.push({ id: sp.id, name: sp.name, phaseOrderIndex: phase.orderIndex });
      }
      setSubPhaseOpts(opts);
    }).finally(() => setLoading(false));
  }, [versionId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const teamName = (id: string) => teams.find(t => t.id === id)?.name ?? id;

  const crOptions = useMemo(() => Array.from(new Set(proposals.map(p => p.crNumber).filter(Boolean))) as string[], [proposals]);
  const systemOptions = useMemo(() => Array.from(new Set(proposals.map(p => p.app).filter(Boolean))) as string[], [proposals]);
  const subPhaseOptionsForPhase = useMemo(
    () => fPhase === 'all' ? [] : subPhaseOpts.filter(sp => sp.phaseOrderIndex === parseInt(fPhase)),
    [subPhaseOpts, fPhase],
  );

  const filtered = proposals.filter(p =>
    (fPhase === 'all' || p.phase === parseInt(fPhase)) &&
    (fSubPhase === 'all' || p.subPhaseId === fSubPhase) &&
    (fCr === 'all' || p.crNumber === fCr) &&
    (fTeam === 'all' || p.teamId === fTeam) &&
    (fSystem === 'all' || p.app === fSystem)
  );

  const assignable = filtered.filter(p => !p.usedInTaskId);
  const byPhase = new Map<number, Proposal[]>();
  for (const p of filtered) {
    if (!byPhase.has(p.phase)) byPhase.set(p.phase, []);
    byPhase.get(p.phase)!.push(p);
  }

  const selectedCrNumbers = Array.from(new Set(Array.from(selected).map(id => proposals.find(p => p.id === id)?.crNumber).filter(Boolean))) as string[];

  const convert = async (proposalIds: string[]) => {
    setConverting(true); setError('');
    try {
      await axios.post(`${API}/task-proposals/version/${versionId}/convert-approved`, { proposalIds }, { headers });
      setSelected(new Set());
      load();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'שגיאה בשיבוץ');
    } finally { setConverting(false); }
  };

  const convertWholeCrs = () => {
    const ids = proposals.filter(p => !p.usedInTaskId && selectedCrNumbers.includes(p.crNumber ?? '')).map(p => p.id);
    convert(ids);
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px', color: C.textMuted, direction: 'rtl', fontFamily: FONT }}>
      <div style={{ fontSize: '36px', marginBottom: '14px' }}>⏳</div>טוען משימות מאושרות...
    </div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: SHADOW.xs, borderRadius: RADIUS.lg, padding: '16px 24px', marginBottom: '16px' }}>
        <div style={{ fontSize: '18px', fontWeight: 800, color: C.textPrimary }}>Release Plan Assignment — שיבוץ לתוכנית המאוחדת</div>
        <div style={{ fontSize: '13.5px', color: C.textMuted, marginTop: '2px' }}>
          {versionName} · משימות שאושרו על ידי מנהל הגרסה, מוכנות לשיבוץ בתוכנית העלייה המאוחדת
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <select value={fPhase} onChange={e => { setFPhase(e.target.value); setFSubPhase('all'); }} style={{ ...selectStyle, color: fPhase !== 'all' ? C.brand : C.textSecondary, borderColor: fPhase !== 'all' ? C.brand : C.borderEm }}>
          <option value="all">שלב: הכל</option>
          {[1, 2, 3, 4].map(ph => <option key={ph} value={ph}>{PHASE_META[ph].icon} {PHASE_META[ph].label}</option>)}
        </select>
        <select value={fSubPhase} onChange={e => setFSubPhase(e.target.value)} disabled={fPhase === 'all'}
          style={{ ...selectStyle, color: fSubPhase !== 'all' ? C.brand : C.textSecondary, borderColor: fSubPhase !== 'all' ? C.brand : C.borderEm, opacity: fPhase === 'all' ? 0.5 : 1 }}>
          <option value="all">תת-שלב: הכל</option>
          {subPhaseOptionsForPhase.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
        <select value={fCr} onChange={e => setFCr(e.target.value)} style={{ ...selectStyle, color: fCr !== 'all' ? C.brand : C.textSecondary, borderColor: fCr !== 'all' ? C.brand : C.borderEm }}>
          <option value="all">CR: הכל</option>
          {crOptions.map(cr => <option key={cr} value={cr}>{cr}</option>)}
        </select>
        <select value={fTeam} onChange={e => setFTeam(e.target.value)} style={{ ...selectStyle, color: fTeam !== 'all' ? C.brand : C.textSecondary, borderColor: fTeam !== 'all' ? C.brand : C.borderEm }}>
          <option value="all">צוות: הכל</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={fSystem} onChange={e => setFSystem(e.target.value)} style={{ ...selectStyle, color: fSystem !== 'all' ? C.brand : C.textSecondary, borderColor: fSystem !== 'all' ? C.brand : C.borderEm }}>
          <option value="all">מערכת: הכל</option>
          {systemOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* ── Bulk bar ── */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px',
          background: C.brandDim, border: `1px solid ${C.brand}40`, borderRadius: RADIUS.md,
          padding: '11px 16px', marginBottom: '14px', fontSize: '12.5px', color: C.brand, fontWeight: 600,
        }}>
          <span>
            נבחרו {selected.size} משימות
            {selectedCrNumbers.length === 1 && ` מתוך ${selectedCrNumbers[0]}`}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedCrNumbers.length > 0 && (
              <button onClick={convertWholeCrs} disabled={converting}
                style={{ padding: '8px 16px', borderRadius: RADIUS.md, fontSize: '12px', fontWeight: 700, border: `1px solid ${C.brand}60`, background: 'none', color: C.brand, cursor: 'pointer' }}>
                שיבוץ כל משימות ה-{selectedCrNumbers.length === 1 ? selectedCrNumbers[0] : 'CR-ים שנבחרו'}
              </button>
            )}
            <button onClick={() => convert(Array.from(selected))} disabled={converting}
              style={{ padding: '8px 16px', borderRadius: RADIUS.md, fontSize: '12px', fontWeight: 700, border: 'none', background: C.brand, color: 'white', cursor: 'pointer' }}>
              {converting ? 'משבץ…' : 'שיבוץ הנבחרים'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}40`, color: C.danger, borderRadius: RADIUS.md, padding: '9px 14px', fontSize: '12.5px', marginBottom: '14px' }}>{error}</div>
      )}

      {/* ── Table ── */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.xs, overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 16px', background: C.bgNested, fontSize: '10.5px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span style={{ width: '16px', flexShrink: 0 }} />
          <span style={{ width: '160px', flexShrink: 0 }}>Phase / Sub Phase</span>
          <span style={{ width: '90px', flexShrink: 0 }}>CR</span>
          <span style={{ flex: 1, minWidth: 0 }}>משימה</span>
          <span style={{ width: '80px', flexShrink: 0 }}>צוות</span>
          <span style={{ width: '80px', flexShrink: 0 }}>מערכת</span>
          <span style={{ width: '110px', flexShrink: 0 }} />
        </div>

        {[1, 2, 3, 4].map(phase => {
          const rows = byPhase.get(phase);
          if (!rows?.length) return null;
          const pm = PHASE_META[phase];
          return (
            <div key={phase}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: C.brandDim, fontSize: '11.5px', fontWeight: 700, color: C.brand }}>
                {pm.icon} {pm.label}
              </div>
              {rows.map(p => {
                const done = !!p.usedInTaskId;
                const subPhaseName = subPhaseOpts.find(sp => sp.id === p.subPhaseId)?.name;
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: `1px solid ${C.bgNested}` }}>
                    <span onClick={() => !done && toggle(p.id)}
                      style={{
                        width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
                        border: `1.5px solid ${done ? C.borderEm : selected.has(p.id) ? C.brand : C.borderEm}`,
                        background: selected.has(p.id) ? C.brand : 'transparent',
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px',
                        cursor: done ? 'default' : 'pointer', opacity: done ? 0.4 : 1,
                      }}>
                      {selected.has(p.id) ? '✓' : ''}
                    </span>
                    <span style={{ width: '160px', flexShrink: 0, fontSize: '11px', color: C.textMuted }}>
                      {pm.label}{subPhaseName ? ` · ${subPhaseName}` : ''}
                    </span>
                    <span style={{ width: '90px', flexShrink: 0, fontFamily: FONT_MONO, fontSize: '11px', color: C.brand }}>{p.crNumber || '—'}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '12.5px', fontWeight: 600, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>
                      {p.title}
                    </span>
                    <span style={{ width: '80px', flexShrink: 0 }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: RADIUS.full, color: 'white', background: teamColor(teamName(p.teamId)) }}>
                        {teamName(p.teamId)}
                      </span>
                    </span>
                    <span style={{ width: '80px', flexShrink: 0, fontSize: '11px', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.app || '—'}</span>
                    <span style={{ width: '110px', flexShrink: 0 }}>
                      {done ? (
                        <span style={{ padding: '6px 13px', borderRadius: RADIUS.sm, fontSize: '11px', fontWeight: 700, background: C.successBg, color: C.success }}>✓ שובץ</span>
                      ) : (
                        <button onClick={() => convert([p.id])} disabled={converting}
                          style={{ padding: '6px 13px', borderRadius: RADIUS.sm, fontSize: '11px', fontWeight: 700, border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textSecondary, cursor: 'pointer' }}>
                          שבץ לתוכנית
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textDisabled }}>
            <div style={{ fontSize: '28px', marginBottom: '10px' }}>📥</div>
            <div style={{ fontSize: '15px' }}>אין משימות מאושרות התואמות את הסינון</div>
          </div>
        )}
      </div>

      {assignable.length > 0 && (
        <div style={{ textAlign: 'center' }}>
          <button onClick={() => convert(assignable.map(p => p.id))} disabled={converting}
            style={{ padding: '10px 24px', borderRadius: RADIUS.md, fontSize: '14px', fontWeight: 700, border: 'none', background: C.success, color: 'white', cursor: 'pointer' }}>
            {converting ? 'משבץ…' : `🚀 שבץ את כל ${assignable.length} המשימות המסוננות`}
          </button>
        </div>
      )}
    </div>
  );
};
