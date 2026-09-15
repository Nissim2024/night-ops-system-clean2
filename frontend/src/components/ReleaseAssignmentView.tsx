import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Button } from './ui';
import { cn } from '../lib/utils';
import { teamColor } from './shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const PHASE_META: Record<number, { label: string; icon: string }> = {
  1: { label: 'בוקר לפני גרסה',   icon: '☀️' },
  2: { label: 'ליל הגרסה — HOTNET', icon: '🌙' },
  3: { label: 'ליל הגרסה — HOT',    icon: '🌅' },
  4: { label: 'בוקר שלאחר גרסה',  icon: '📅' },
};
interface Proposal {
  id: string; teamId: string; title: string; app?: string | null; actionType?: string | null;
  phase: number; subPhaseId?: string | null; crNumber?: string | null; crLabel?: string | null;
  reviewStatus: string; usedInTaskId?: string | null;
}
interface SubPhaseOpt { id: string; name: string; phaseOrderIndex: number }
interface Props { token: string; versionId: string; versionName: string; }

// Base look shared by every filter-bar select — a small rounded pill,
// consistent with the compact filter chips used elsewhere in the app.
const selectBaseClass = 'cursor-pointer rounded-full border bg-card px-[11px] py-1.5 text-[12.5px] font-semibold';
const selectActiveClass = 'border-primary text-primary';
const selectInactiveClass = 'border-border text-muted-foreground';

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
    <div dir="rtl" className="p-20 text-center text-subtle-foreground">
      <div className="mb-3.5 text-4xl">⏳</div>טוען משימות מאושרות...
    </div>
  );

  return (
    <div dir="rtl">
      <div className="mb-4 rounded-lg border border-border bg-card px-6 py-4 shadow-xs">
        <div className="text-lg font-extrabold text-foreground">Release Plan Assignment — שיבוץ לתוכנית המאוחדת</div>
        <div className="mt-0.5 text-[13.5px] text-subtle-foreground">
          {versionName} · משימות שאושרו על ידי מנהל הגרסה, מוכנות לשיבוץ בתוכנית העלייה המאוחדת
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="mb-3.5 flex flex-wrap gap-2">
        <select
          value={fPhase}
          onChange={e => { setFPhase(e.target.value); setFSubPhase('all'); }}
          className={cn(selectBaseClass, fPhase !== 'all' ? selectActiveClass : selectInactiveClass)}
        >
          <option value="all">שלב: הכל</option>
          {[1, 2, 3, 4].map(ph => <option key={ph} value={ph}>{PHASE_META[ph].icon} {PHASE_META[ph].label}</option>)}
        </select>
        <select
          value={fSubPhase}
          onChange={e => setFSubPhase(e.target.value)}
          disabled={fPhase === 'all'}
          className={cn(selectBaseClass, fSubPhase !== 'all' ? selectActiveClass : selectInactiveClass, fPhase === 'all' && 'cursor-not-allowed opacity-50')}
        >
          <option value="all">תת-שלב: הכל</option>
          {subPhaseOptionsForPhase.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
        <select
          value={fCr}
          onChange={e => setFCr(e.target.value)}
          className={cn(selectBaseClass, fCr !== 'all' ? selectActiveClass : selectInactiveClass)}
        >
          <option value="all">CR: הכל</option>
          {crOptions.map(cr => <option key={cr} value={cr}>{cr}</option>)}
        </select>
        <select
          value={fTeam}
          onChange={e => setFTeam(e.target.value)}
          className={cn(selectBaseClass, fTeam !== 'all' ? selectActiveClass : selectInactiveClass)}
        >
          <option value="all">צוות: הכל</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={fSystem}
          onChange={e => setFSystem(e.target.value)}
          className={cn(selectBaseClass, fSystem !== 'all' ? selectActiveClass : selectInactiveClass)}
        >
          <option value="all">מערכת: הכל</option>
          {systemOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* ── Bulk bar ── */}
      {selected.size > 0 && (
        <div className="mb-3.5 flex items-center justify-between gap-3.5 rounded-md border border-primary/40 bg-primary-50 px-4 py-[11px] text-[12.5px] font-semibold text-primary">
          <span>
            נבחרו {selected.size} משימות
            {selectedCrNumbers.length === 1 && ` מתוך ${selectedCrNumbers[0]}`}
          </span>
          <div className="flex gap-2">
            {selectedCrNumbers.length > 0 && (
              <Button
                onClick={convertWholeCrs}
                disabled={converting}
                variant="ghost"
                size="sm"
                className="border border-primary/60 bg-transparent text-primary hover:bg-primary-50"
              >
                שיבוץ כל משימות ה-{selectedCrNumbers.length === 1 ? selectedCrNumbers[0] : 'CR-ים שנבחרו'}
              </Button>
            )}
            <Button onClick={() => convert(Array.from(selected))} disabled={converting} variant="primary" size="sm">
              {converting ? 'משבץ…' : 'שיבוץ הנבחרים'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3.5 rounded-md border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>
      )}

      {/* ── Table ── */}
      <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className="flex items-center gap-3 bg-muted px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[.04em] text-subtle-foreground">
          <span className="w-4 shrink-0" />
          <span className="w-40 shrink-0">Phase / Sub Phase</span>
          <span className="w-[90px] shrink-0">CR</span>
          <span className="min-w-0 flex-1">משימה</span>
          <span className="w-20 shrink-0">צוות</span>
          <span className="w-20 shrink-0">מערכת</span>
          <span className="w-[110px] shrink-0" />
        </div>

        {[1, 2, 3, 4].map(phase => {
          const rows = byPhase.get(phase);
          if (!rows?.length) return null;
          const pm = PHASE_META[phase];
          return (
            <div key={phase}>
              <div className="flex items-center gap-2.5 bg-primary-50 px-4 py-2.5 text-[11.5px] font-bold text-primary">
                {pm.icon} {pm.label}
              </div>
              {rows.map(p => {
                const done = !!p.usedInTaskId;
                const subPhaseName = subPhaseOpts.find(sp => sp.id === p.subPhaseId)?.name;
                return (
                  <div key={p.id} className="flex items-center gap-3 border-b border-muted px-4 py-3">
                    <span
                      onClick={() => !done && toggle(p.id)}
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-white',
                        'border-[1.5px]',
                        selected.has(p.id) ? 'border-primary bg-primary' : 'border-border bg-transparent',
                        done ? 'cursor-default opacity-40' : 'cursor-pointer',
                      )}
                    >
                      {selected.has(p.id) ? '✓' : ''}
                    </span>
                    <span className="w-40 shrink-0 text-[11px] text-subtle-foreground">
                      {pm.label}{subPhaseName ? ` · ${subPhaseName}` : ''}
                    </span>
                    <span className="w-[90px] shrink-0 font-mono text-[11px] text-primary">{p.crNumber || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground" title={p.title}>
                      {p.title}
                    </span>
                    <span className="w-20 shrink-0">
                      {(() => {
                        const tColor = teamColor(teamName(p.teamId));
                        return (
                          <span
                            className="rounded-full px-2.5 py-[3px] text-[10px] font-bold"
                            style={{ background: tColor.bg, color: tColor.color }}
                          >
                            {teamName(p.teamId)}
                          </span>
                        );
                      })()}
                    </span>
                    <span className="w-20 shrink-0 truncate text-[11px] text-subtle-foreground">{p.app || '—'}</span>
                    <span className="w-[110px] shrink-0">
                      {done ? (
                        <span className="rounded-sm bg-success-bg px-3 py-1.5 text-[11px] font-bold text-success">✓ שובץ</span>
                      ) : (
                        <Button onClick={() => convert([p.id])} disabled={converting} variant="secondary" size="sm" className="text-[11px]">
                          שבץ לתוכנית
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="p-10 text-center text-subtle-foreground">
            <div className="mb-2.5 text-[28px]">📥</div>
            <div className="text-base">אין משימות מאושרות התואמות את הסינון</div>
          </div>
        )}
      </div>

      {assignable.length > 0 && (
        <div className="text-center">
          <Button onClick={() => convert(assignable.map(p => p.id))} disabled={converting} variant="success" size="lg">
            {converting ? 'משבץ…' : `🚀 שבץ את כל ${assignable.length} המשימות המסוננות`}
          </Button>
        </div>
      )}
    </div>
  );
};
