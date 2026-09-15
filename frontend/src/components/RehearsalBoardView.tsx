import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { Card, SectionHeader, StatusChip, Badge } from './ui';
import { formatTime, formatDateTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';

interface Props {
  token: string;
  versionId: string;
}

const fmtTime = (d?: string | Date | null) => d ? formatTime(d) : '—';

// Fixed column widths shared by every sub-phase table on this screen — each
// sub-phase renders its own <table>, so without a shared layout the browser
// auto-sizes each one from its own content and columns drift out of
// alignment section to section, even though headers/cells match within any
// single table.
const COLUMN_WIDTHS = ['34%', '13%', '11%', '15%', '15%', '12%'];

// Read-only replay of the rehearsal's execution board + GO/NO-GO outcome,
// reconstructed from Version.lastRehearsalSnapshot (frozen at end-rehearsal
// time) — the live board/dashboard show the real night once it starts, so
// this is the only place the rehearsal's actual task-level history survives.
export const RehearsalBoardView: React.FC<Props> = ({ token, versionId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [lastRehearsalAt, setLastRehearsalAt] = useState<string | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubPhases, setCollapsedSubPhases] = useState<Set<string>>(new Set());
  const togglePhase = (key: string) => setCollapsedPhases(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleSubPhase = (key: string) => setCollapsedSubPhases(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  useEffect(() => {
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };
    axios.get(`${API}/versions/${versionId}`, { headers })
      .then(res => {
        if (cancelled) return;
        setSnapshot(res.data?.lastRehearsalSnapshot ?? []);
        setPhases([...(res.data?.phases ?? [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex));
        setLastRehearsalAt(res.data?.lastRehearsalAt ?? null);
      })
      .catch(() => !cancelled && setError('שגיאה בטעינת נתוני החזרה'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [token, versionId]);

  if (loading) return <div className="p-6 font-sans text-subtle-foreground">טוען...</div>;
  if (error) return <div className="p-6 font-sans text-danger">{error}</div>;
  if (snapshot.length === 0) {
    return (
      <div className="p-6 font-sans text-subtle-foreground">
        אין נתוני חזרה גנרלית שמורים לגרסה זו.
      </div>
    );
  }

  // subPhaseId -> { phaseName, subPhaseName, phaseOrder, subOrder, isGoNoGo }
  const subPhaseMeta = new Map<string, { phaseName: string; subPhaseName: string; phaseOrder: number; subOrder: number; isGoNoGo: boolean }>();
  phases.forEach((ph: any) => {
    (ph.subPhases ?? []).forEach((sp: any) => {
      subPhaseMeta.set(sp.id, {
        phaseName: ph.name, subPhaseName: sp.name,
        phaseOrder: ph.orderIndex, subOrder: sp.orderIndex,
        isGoNoGo: !!ph.isGoNoGo,
      });
    });
  });

  const goNoGoPhase = phases.find((ph: any) => ph.isGoNoGo);
  const criticalTasks = goNoGoPhase
    ? snapshot.filter((t: any) => t.isCriticalForGo && subPhaseMeta.get(t.subPhaseId)?.phaseName === goNoGoPhase.name)
    : [];
  const criticalFailed = criticalTasks.filter((t: any) => !['DONE'].includes(t.status) && !t.goNoGoWaived);
  const waivedTasks = criticalTasks.filter((t: any) => t.goNoGoWaived);
  const goDecision = criticalTasks.length === 0 ? null : criticalFailed.length === 0 ? 'GO' : 'NO_GO';

  // Group by phase then sub-phase, preserving orderIndex; tasks without a match go last.
  const grouped = new Map<string, { phaseName: string; phaseOrder: number; subs: Map<string, { subPhaseName: string; subOrder: number; tasks: any[] }> }>();
  const NO_PHASE_KEY = '__none__';
  for (const t of snapshot) {
    const meta = t.subPhaseId ? subPhaseMeta.get(t.subPhaseId) : undefined;
    const phaseKey = meta ? meta.phaseName : NO_PHASE_KEY;
    if (!grouped.has(phaseKey)) {
      grouped.set(phaseKey, { phaseName: meta ? meta.phaseName : 'ללא שלב', phaseOrder: meta ? meta.phaseOrder : 999999, subs: new Map() });
    }
    const phaseGroup = grouped.get(phaseKey)!;
    const subKey = meta ? meta.subPhaseName : NO_PHASE_KEY;
    if (!phaseGroup.subs.has(subKey)) {
      phaseGroup.subs.set(subKey, { subPhaseName: meta ? meta.subPhaseName : 'ללא תת-שלב', subOrder: meta ? meta.subOrder : 999999, tasks: [] });
    }
    phaseGroup.subs.get(subKey)!.tasks.push(t);
  }
  const orderedPhaseGroups = Array.from(grouped.values()).sort((a, b) => a.phaseOrder - b.phaseOrder);

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      <Card>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-[22px]">🎭</span>
          <div className="flex-1 font-sans text-md font-bold text-foreground">לוח חזרה גנרלית — היסטורי (לקריאה בלבד)</div>
          <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubPhases(new Set()); }} className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-[15px] text-muted-foreground">▼ פתח הכל</button>
          <button onClick={() => {
            setCollapsedPhases(new Set(orderedPhaseGroups.map(g => g.phaseName)));
            setCollapsedSubPhases(new Set(orderedPhaseGroups.flatMap(g => Array.from(g.subs.values()).map(s => `${g.phaseName}::${s.subPhaseName}`))));
          }} className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-[15px] text-muted-foreground">► סגור הכל</button>
        </div>
        <div className="font-sans text-xs text-subtle-foreground">
          תמונת מצב קפואה מרגע סיום החזרה{lastRehearsalAt ? ` (${formatDateTime(lastRehearsalAt)})` : ''}. מציג את מצב המשימות כפי שהיה בחזרה — לא ניתן לערוך.
        </div>
      </Card>

      {goNoGoPhase && (
        <Card style={{ borderInlineStart: `4px solid ${goDecision === 'GO' ? C.success : goDecision === 'NO_GO' ? C.danger : C.border}` }}>
          <SectionHeader
            title={`GO/NO-GO בחזרה — שלב "${goNoGoPhase.name}"`}
            action={goDecision && (
              <StatusChip status={goDecision === 'GO' ? 'DONE' : 'FAILED'} size="md" />
            )}
          />
          {waivedTasks.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {waivedTasks.map((t: any) => (
                <div key={t.id} className="font-sans text-xs text-muted-foreground">
                  ⚠️ <strong>{t.title}</strong> — עבר בעקיפה (waived) ע"י {t.waivedBy ?? '—'}{t.waivedAt ? ` ב-${fmtTime(t.waivedAt)}` : ''}
                </div>
              ))}
            </div>
          )}
          {criticalFailed.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {criticalFailed.map((t: any) => (
                <div key={t.id} className="font-sans text-xs text-danger">
                  ❌ <strong>{t.title}</strong> — {t.status === 'BLOCKED' ? t.blockedReason : t.failedReason ?? 'לא הושלם'}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {orderedPhaseGroups.map(phaseGroup => (
        <Card key={phaseGroup.phaseName} padding={4}>
          <h3
            onClick={() => togglePhase(phaseGroup.phaseName)}
            className="mb-2.5 mt-0 flex cursor-pointer select-none items-center gap-2 font-sans text-[17px] font-semibold text-foreground"
          >
            <span className="text-[15px] text-subtle-foreground">{collapsedPhases.has(phaseGroup.phaseName) ? '►' : '▼'}</span>
            <span>{phaseGroup.phaseName}</span>
            <span className="text-sm font-normal text-subtle-foreground">({phaseGroup.subs.size} תת-שלבים)</span>
          </h3>
          {!collapsedPhases.has(phaseGroup.phaseName) && Array.from(phaseGroup.subs.values()).sort((a, b) => a.subOrder - b.subOrder).map(sub => {
            const subKey = `${phaseGroup.phaseName}::${sub.subPhaseName}`;
            return (
            <div key={sub.subPhaseName} className="mb-3.5">
              <h4
                onClick={() => toggleSubPhase(subKey)}
                className="mb-1.5 mt-0 flex cursor-pointer select-none items-center gap-1.5 font-sans text-[15px] font-semibold text-foreground"
              >
                <span className="text-xs text-subtle-foreground">{collapsedSubPhases.has(subKey) ? '►' : '▼'}</span>
                <span>{sub.subPhaseName}</span>
                <span className="text-xs font-normal text-subtle-foreground">({sub.tasks.length})</span>
              </h4>
              {!collapsedSubPhases.has(subKey) && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    {COLUMN_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted">
                      {['משימה', 'צוות', 'סטטוס', 'מתוכנן', 'בפועל', 'הערה'].map(h => (
                        <th key={h} className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-2.5 py-1.5 text-end font-sans text-xs font-semibold text-subtle-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sub.tasks.sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)).map((t: any) => {
                      const reason = t.blockedReason ?? t.delayReason ?? t.failedReason;
                      return (
                        <tr key={t.id} className="border-b border-border">
                          <td className="break-words px-2.5 py-1.5 font-sans text-sm text-foreground">
                            {t.title}{t.isCriticalForGo && <Badge color={C.brand} bg={`${C.brand}12`} style={{ marginInlineStart: '6px' }}>GO</Badge>}
                          </td>
                          <td className="overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-1.5 font-sans text-sm text-muted-foreground">{t.assignedTeam?.name ?? '—'}</td>
                          <td className="px-2.5 py-1.5"><StatusChip status={t.status} /></td>
                          <td className="px-2.5 py-1.5 font-sans text-xs text-subtle-foreground">
                            {fmtTime(t.rehearsalPlannedStart)} – {fmtTime(t.rehearsalPlannedEnd)}
                          </td>
                          <td className="px-2.5 py-1.5 font-sans text-xs text-subtle-foreground">
                            {fmtTime(t.actualStart)} – {fmtTime(t.actualFinish)}
                          </td>
                          <td className={`px-2.5 py-1.5 font-sans text-xs ${reason ? 'text-danger' : 'text-subtle-foreground'}`}>{reason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
};
