import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, TEXT, WEIGHT, RADIUS, FONT } from '../theme';
import { Card, SectionHeader, StatusChip, Badge } from './ui';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';

interface Props {
  token: string;
  versionId: string;
}

const fmtTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '—';

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

  if (loading) return <div style={{ padding: '24px', color: C.textMuted, fontFamily: FONT }}>טוען...</div>;
  if (error) return <div style={{ padding: '24px', color: C.danger, fontFamily: FONT }}>{error}</div>;
  if (snapshot.length === 0) {
    return (
      <div style={{ padding: '24px', color: C.textMuted, fontFamily: FONT }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 28px' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🎭</span>
          <div style={{ ...TEXT.md, fontWeight: WEIGHT.bold, color: C.textPrimary, fontFamily: FONT }}>לוח חזרה גנרלית — היסטורי (לקריאה בלבד)</div>
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>
          תמונת מצב קפואה מרגע סיום החזרה{lastRehearsalAt ? ` (${new Date(lastRehearsalAt).toLocaleString('he-IL')})` : ''}. מציג את מצב המשימות כפי שהיה בחזרה — לא ניתן לערוך.
        </div>
      </Card>

      {goNoGoPhase && (
        <Card style={{ borderRight: `4px solid ${goDecision === 'GO' ? C.success : goDecision === 'NO_GO' ? C.danger : C.border}` }}>
          <SectionHeader
            title={`GO/NO-GO בחזרה — שלב "${goNoGoPhase.name}"`}
            action={goDecision && (
              <StatusChip status={goDecision === 'GO' ? 'DONE' : 'FAILED'} size="md" />
            )}
          />
          {waivedTasks.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {waivedTasks.map((t: any) => (
                <div key={t.id} style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT }}>
                  ⚠️ <strong>{t.title}</strong> — עבר בעקיפה (waived) ע"י {t.waivedBy ?? '—'}{t.waivedAt ? ` ב-${fmtTime(t.waivedAt)}` : ''}
                </div>
              ))}
            </div>
          )}
          {criticalFailed.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {criticalFailed.map((t: any) => (
                <div key={t.id} style={{ ...TEXT.xs, color: C.danger, fontFamily: FONT }}>
                  ❌ <strong>{t.title}</strong> — {t.status === 'BLOCKED' ? t.blockedReason : t.failedReason ?? 'לא הושלם'}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {orderedPhaseGroups.map(phaseGroup => (
        <Card key={phaseGroup.phaseName} padding={4}>
          <SectionHeader title={phaseGroup.phaseName} style={{ marginBottom: '10px' }} />
          {Array.from(phaseGroup.subs.values()).sort((a, b) => a.subOrder - b.subOrder).map(sub => (
            <div key={sub.subPhaseName} style={{ marginBottom: '14px' }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, fontFamily: FONT, marginBottom: '6px' }}>
                {sub.subPhaseName}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.bgNested }}>
                      {['משימה', 'צוות', 'סטטוס', 'מתוכנן', 'בפועל', 'הערה'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'right', ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.semibold, borderBottom: `1px solid ${C.border}`, fontFamily: FONT }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sub.tasks.sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)).map((t: any) => {
                      const reason = t.blockedReason ?? t.delayReason ?? t.failedReason;
                      return (
                        <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '6px 10px', ...TEXT.sm, color: C.textPrimary, fontFamily: FONT }}>
                            {t.title}{t.isCriticalForGo && <Badge color={C.brand} bg={`${C.brand}12`} style={{ marginRight: '6px' }}>GO</Badge>}
                          </td>
                          <td style={{ padding: '6px 10px', ...TEXT.sm, color: C.textSecondary, fontFamily: FONT }}>{t.assignedTeam?.name ?? '—'}</td>
                          <td style={{ padding: '6px 10px' }}><StatusChip status={t.status} /></td>
                          <td style={{ padding: '6px 10px', ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>
                            {fmtTime(t.rehearsalPlannedStart)} – {fmtTime(t.rehearsalPlannedEnd)}
                          </td>
                          <td style={{ padding: '6px 10px', ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>
                            {fmtTime(t.actualStart)} – {fmtTime(t.actualFinish)}
                          </td>
                          <td style={{ padding: '6px 10px', ...TEXT.xs, color: reason ? C.danger : C.textMuted, fontFamily: FONT }}>{reason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
};
