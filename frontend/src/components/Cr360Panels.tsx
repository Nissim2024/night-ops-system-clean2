import React, { useState } from 'react';
import { C } from '../theme';
import { Card, Badge } from './ui';
import { formatDate } from '../utils/dateFormat';
import { BrandedDialog, DialogButton } from './ui/BrandedDialog';

// The full picture of a CR in one version (user, 2026-10-10) — rendered under
// the CR card in "חיפוש CR" (version management + home page). Data: GET
// /release-intelligence/cr-360/:cr?versionId (backend cr-360.ts). Every number
// that stands for defects opens exactly those defects (onDrill → id list).

type Light = 'green' | 'amber' | 'red';
interface D { id: string; title: string; severity: string; status: string; open: boolean; defectType: string; cycle: string; detectedOn: string; isProd: boolean }
interface CovRow { cycleName: string; passed: number; failed: number; blocked: number; notRun: number; notCompleted: number; notReady: number; total: number; executedPct: number; responsible: string }
interface PlanTeam {
  team: string; state: 'approved' | 'not-needed' | 'submitted' | 'returned' | 'draft' | 'not-started';
  submittedBy: string | null; approvedBy: string | null; returnReason: string | null; riskLevel: string | null;
  plan: null | {
    workPlan: string | null; scripts: string | null; runTimes: string | null; rollbackPlan: string | null;
    gradualRollout: boolean; gradualDetails: string | null; nightTestingNotes: string | null; morningMonitoring: string | null;
    actions: { description: string; phase: number; system: string | null; ownerName: string | null }[];
    monitoring: { type: string; name: string; note: string | null }[];
  };
}
interface Dep { crNumber: string; note: string | null; team: string; crLabel: string; inVersion: boolean; executedPct: number | null; testsFinished: boolean; openDefectIds: string[] }
export interface Cr360 {
  crNumber: string; crLabel: string; versionId: string | null;
  versions: { id: string; name: string; goLive: string | null; archived: boolean; historical?: boolean; listed?: boolean; qcDefects?: { defects: number; open: number } | null }[];
  // QC releases with defects of the CR that no one opened as a version (2026-10-10)
  qcOnly?: { relId: number | null; releaseName: string; defects: number; open: number }[];
  historical?: boolean;          // a QC release opened as a version — QC data only
  listedInVersion?: boolean;     // the version's CR list has it (else found through its QC defects)
  version?: { id: string; name: string; goLive: string | null; daysToGoLive: number | null };
  light?: { light: Light; reasons: { key: string; light: Light; text: string }[] };
  defects?: { testing: D[]; afterGoLive: D[]; blocking: D[] };
  coverage?: { cycles: CovRow[]; finished: boolean };
  risks?: {
    daily: { risk: string; reasons: string[]; progressPct: number; tester: string | null } | null;
    plans: { team: string; level: string }[];
    blockers: { id: string; title: string; type: string; owner: string | null; status: string; createdAt: string }[];
    manual: { id: string; title: string; severity: string; probability: string | null; impact: string | null; mitigation: string | null; status: string; owner: string | null }[];
  };
  uat?: { planned: boolean; done: boolean; coverage: CovRow[]; testers: string[]; defects: D[]; window: { start: string; end: string } | null };
  testSummary?: { finished: boolean; text: string | null };
  plan?: { status: 'none' | 'complete' | 'partial' | 'not-opened'; teams: PlanTeam[] };
  dependencies?: { dependsOn: Dep[]; dependedBy: Dep[] };
  timeline?: { key: string; label: string; start: string; end: string | null; mine: { start: string; end: string; tester: string } | null }[];
}

const LIGHT: Record<Light, { color: string; bg: string; label: string; icon: string }> = {
  green: { color: C.success, bg: C.bgDone, label: 'מוכן לעלייה', icon: '🟢' },
  amber: { color: C.warning, bg: C.warningBg, label: 'בסיכון', icon: '🟠' },
  red: { color: C.danger, bg: C.bgBlocked, label: 'לא מוכן', icon: '🔴' },
};
const SEVERITIES = ['Show Stopper', 'Severe', 'Medium', 'Low'];
const SEV_COLOR: Record<string, string> = { 'Show Stopper': '#B42318', Severe: '#E8590C', Medium: '#5B4BC4', Low: '#2F6FDB' };
const PLAN_STATE: Record<PlanTeam['state'], [string, string]> = {
  approved: ['✓ אושרה', C.success], 'not-needed': ['לא נדרשת', C.textMuted], submitted: ['הוגשה — ממתינה לאישור', C.statusOpen],
  returned: ['הוחזרה לתיקון', C.danger], draft: ['בכתיבה', C.warning], 'not-started': ['לא נפתחה', C.danger],
};
const RISK_HE: Record<string, string> = { HIGH: 'גבוה', MEDIUM: 'בינוני', LOW: 'נמוך', CRITICAL: 'קריטי' };
const RISK_COLOR: Record<string, string> = { HIGH: C.danger, CRITICAL: C.danger, MEDIUM: C.warning, LOW: C.success };
const PHASE_HE: Record<number, string> = { 1: 'בוקר לפני הגרסה', 2: 'HOTNET', 3: 'HOT', 4: 'בוקר שאחרי' };

// a clickable count — opens the defects behind it
const Num: React.FC<{ ids: string[]; title: string; onDrill: (t: string, ids: string[]) => void; color?: string; strong?: boolean }> = ({ ids, title, onDrill, color, strong }) => (
  ids.length === 0
    ? <span className="tabular-nums text-subtle-foreground">0</span>
    : <button onClick={() => onDrill(title, ids)} title="הצג את התקלות" aria-label={title}
        className={`cursor-pointer border-none bg-transparent p-0 tabular-nums underline-offset-2 hover:underline ${strong ? 'font-bold' : 'font-semibold'}`}
        style={{ color: color ?? C.brand }}>{ids.length}</button>
);
const PanelTitle: React.FC<{ icon: string; title: string; right?: React.ReactNode }> = ({ icon, title, right }) => (
  <div className="mb-3 flex items-center gap-2">
    <div className="text-sm font-bold text-foreground">{icon} {title}</div>
    {right && <div className="ms-auto">{right}</div>}
  </div>
);
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="text-xs text-subtle-foreground">{children}</div>;
const ids = (ds: D[]) => ds.map(d => d.id);
const groupBy = (ds: D[], key: (d: D) => string) => {
  const m = new Map<string, D[]>();
  for (const d of ds) { const k = key(d) || 'ללא ערך'; m.set(k, [...(m.get(k) ?? []), d]); }
  return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
};

// What DeployCenter itself manages doesn't exist for a historical version
const NotManaged: React.FC = () => <Empty>לא נוהל ב-DeployCenter — גרסה היסטורית שנפתחה מ-QC.</Empty>;

export const Cr360Panels: React.FC<{
  data: Cr360; onDrill: (title: string, ids: string[]) => void; onOpenCr: (cr: string) => void;
}> = ({ data, onDrill, onOpenCr }) => {
  const hist = !!data.historical;
  const [planOpen, setPlanOpen] = useState<string | null>(null);   // team name or '*'
  const [flash, setFlash] = useState<string | null>(null);
  const cr = data.crNumber;
  if (!data.versionId || !data.defects || !data.light) return null;   // nothing in any version — see QcReleasesNotice
  const t = data.defects.testing;
  const open = t.filter(d => d.open);
  const L = LIGHT[data.light.light];
  const go = (id: string) => { setFlash(id); document.getElementById(`cr360-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => setFlash(null), 1600); };
  const box = (id: string) => ({ id: `cr360-${id}`, style: flash === id ? { boxShadow: `0 0 0 2px ${C.brand}` } : undefined });
  const onReason = (key: string) => {
    if (key === 'ss') onDrill(`CR ${cr} — Show Stopper פתוחות`, ids(open.filter(d => d.severity === 'Show Stopper')));
    else if (key === 'severe') onDrill(`CR ${cr} — Severe פתוחות`, ids(open.filter(d => d.severity === 'Severe')));
    else if (key === 'plan') setPlanOpen('*');
    else go(key === 'tests' ? 'coverage' : key === 'uat' ? 'uat' : 'risks');
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── overall status ── */}
      <div className="rounded-xl border px-4 py-3" style={{ borderColor: L.color, background: L.bg }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-bold" style={{ color: L.color }}>{L.icon} {L.label}</span>
          {data.version?.goLive && (
            <span className="text-xs text-muted-foreground">
              עלייה לאוויר {formatDate(data.version.goLive)}
              {data.version.daysToGoLive != null && <> · {data.version.daysToGoLive === 0 ? 'היום'
                : data.version.daysToGoLive > 0 ? `בעוד ${data.version.daysToGoLive} ימים` : `עלתה לפני ${-data.version.daysToGoLive} ימים`}</>}
            </span>
          )}
        </div>
        {(hist || data.listedInVersion === false) && (
          <div className="mt-1 text-xs text-muted-foreground">
            {hist && 'גרסה היסטורית שנפתחה מ-QC — מוצגים נתוני QC בלבד (תקלות, כיסוי, UAT, סיכום בדיקות). '}
            {data.listedInVersion === false && 'ה-CR לא ברשימת ה-CR-ים של הגרסה — נמצא לפי התקלות שנפתחו עליו ב-QC.'}
          </div>
        )}
        {data.light.reasons.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.light.reasons.map((r, i) => (
              <button key={i} onClick={() => onReason(r.key)} title="לחץ לפרטים"
                className="cursor-pointer rounded-full border bg-card px-2.5 py-0.5 text-xs font-semibold hover:shadow-sm"
                style={{ borderColor: LIGHT[r.light].color, color: LIGHT[r.light].color }}>{r.text}</button>
            ))}
          </div>
        ) : <div className="mt-1 text-xs text-muted-foreground">אין תקלות חוסמות, הבדיקות הסתיימו ותוכנית ההטמעה הושלמה.</div>}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        {/* ── defects ── */}
        <Card padding={4}>
          <div {...box('defects')}>
            <PanelTitle icon="🐞" title="באגים" right={<span className="text-xs text-subtle-foreground">בגרסה {data.version?.name} · סביבות בדיקה</span>} />
            {t.length === 0 ? <Empty>לא נפתחו תקלות על ה-CR בגרסה הזו.</Empty> : (
              <div className="flex flex-col gap-4">
                <table className="w-full border-collapse text-[13px]">
                  <thead><tr className="text-xs text-subtle-foreground">
                    <th className="pb-1 text-start font-semibold">חומרה</th><th className="pb-1 text-start font-semibold">סה"כ נפתחו</th><th className="pb-1 text-start font-semibold">פתוחות</th>
                  </tr></thead>
                  <tbody>
                    {[...SEVERITIES, ...Array.from(new Set(t.map(d => d.severity))).filter(s => !SEVERITIES.includes(s))].map(s => {
                      const all = t.filter(d => d.severity === s); if (!all.length) return null;
                      return (
                        <tr key={s} className="border-t border-border">
                          <td className="py-1.5"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: SEV_COLOR[s] ?? C.textMuted }} />{s || 'ללא'}</td>
                          <td className="py-1.5"><Num ids={ids(all)} title={`CR ${cr} — ${s}`} onDrill={onDrill} /></td>
                          <td className="py-1.5"><Num ids={ids(all.filter(d => d.open))} title={`CR ${cr} — ${s} פתוחות`} onDrill={onDrill} color={C.danger} /></td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border font-bold">
                      <td className="py-1.5">סה"כ</td>
                      <td className="py-1.5"><Num ids={ids(t)} title={`CR ${cr} — כל התקלות`} onDrill={onDrill} strong /></td>
                      <td className="py-1.5"><Num ids={ids(open)} title={`CR ${cr} — תקלות פתוחות`} onDrill={onDrill} color={C.danger} strong /></td>
                    </tr>
                  </tbody>
                </table>
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-subtle-foreground">לפי סוג תקלה (Bug Type)</div>
                  <div className="flex flex-col gap-1">
                    {groupBy(t, d => d.defectType).map(([type, ds]) => (
                      <div key={type} className="flex items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate" title={type}>{type}</span>
                        <div className="h-2 w-[40%] overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(ds.length / t.length) * 100}%`, background: C.brand }} /></div>
                        <span className="w-8 text-end"><Num ids={ids(ds)} title={`CR ${cr} — Bug Type: ${type}`} onDrill={onDrill} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {data.defects.blocking.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-semibold" style={{ color: C.danger }}>⛔ תקלות חוסמות פתוחות — מהוותיקה לחדשה</div>
                <div className="flex flex-col gap-1">
                  {data.defects.blocking.slice(0, 8).map(d => (
                    <button key={d.id} onClick={() => onDrill(`תקלה ${d.id}`, [d.id])}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-start text-xs hover:bg-muted">
                      <span className="font-semibold" style={{ color: SEV_COLOR[d.severity] }}>{d.severity}</span>
                      <span className="text-primary">#{d.id}</span>
                      <span className="min-w-0 flex-1 truncate" dir="auto" title={d.title}>{d.title}</span>
                      <span className="shrink-0 text-subtle-foreground">{d.status}{d.detectedOn ? ` · ${formatDate(d.detectedOn)}` : ''}</span>
                    </button>
                  ))}
                  {data.defects.blocking.length > 8 && (
                    <button onClick={() => onDrill(`CR ${cr} — חוסמות פתוחות`, ids(data.defects!.blocking))} className="cursor-pointer self-start border-none bg-transparent p-0 text-xs font-semibold text-primary">
                      כל {data.defects.blocking.length} החוסמות ←
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="mt-4 border-t border-border pt-3 text-xs">
              <span className="font-semibold text-foreground">🏭 תקלות ייצור אחרי העלייה: </span>
              {data.defects.afterGoLive.length === 0
                ? <span className="text-subtle-foreground">אין</span>
                : <>
                    <Num ids={ids(data.defects.afterGoLive)} title={`CR ${cr} — תקלות ייצור אחרי העלייה`} onDrill={onDrill} strong />
                    <span className="text-subtle-foreground"> ({data.defects.afterGoLive.filter(d => d.open).length} פתוחות) · </span>
                    {SEVERITIES.map(s => { const ds = data.defects!.afterGoLive.filter(d => d.severity === s); return ds.length ? (
                      <span key={s} className="me-2"><span style={{ color: SEV_COLOR[s] }}>{s}</span> <Num ids={ids(ds)} title={`CR ${cr} — ייצור ${s}`} onDrill={onDrill} /></span>
                    ) : null; })}
                  </>}
            </div>
          </div>
        </Card>

        {/* ── coverage ── */}
        <Card padding={4}>
          <div {...box('coverage')}>
            <PanelTitle icon="📊" title="מצב הכיסוי" right={data.coverage!.cycles.length > 0 && (
              data.coverage!.finished ? <Badge color={C.success} bg={C.bgDone}>✓ הבדיקות הסתיימו</Badge> : <Badge color={C.warning} bg={C.warningBg}>בבדיקות</Badge>
            )} />
            {data.coverage!.cycles.length === 0 ? <Empty>אין בדיקות משויכות ל-CR ב-QC בגרסה הזו.</Empty> : (
              <div className="flex flex-col gap-3">
                {data.coverage!.cycles.map(c => {
                  const cycleDefects = t.filter(d => d.cycle && d.cycle.toLowerCase() === c.cycleName.toLowerCase());
                  const seg = (n: number, col: string, lbl: string) => n > 0 && <div title={`${lbl}: ${n}`} style={{ width: `${(n / c.total) * 100}%`, background: col }} />;
                  return (
                    <div key={c.cycleName}>
                      <div className="mb-1 flex items-center gap-2 text-[13px]">
                        <span className="font-semibold text-foreground">{c.cycleName}</span>
                        <span className="text-subtle-foreground">{c.executedPct}% בוצע · {c.total} בדיקות</span>
                        <span className="ms-auto text-xs text-subtle-foreground">תקלות בסבב: <Num ids={ids(cycleDefects)} title={`CR ${cr} — תקלות בסבב ${c.cycleName}`} onDrill={onDrill} /></span>
                      </div>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                        {seg(c.passed, C.success, 'עברו')}{seg(c.failed, C.danger, 'נכשלו')}{seg(c.blocked, '#7A5AF8', 'חסומות')}{seg(c.notCompleted, C.warning, 'לא הושלמו')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-subtle-foreground">
                        <span style={{ color: C.success }}>עברו {c.passed}</span><span style={{ color: C.danger }}>נכשלו {c.failed}</span>
                        <span>חסומות {c.blocked}</span><span>לא הושלמו {c.notCompleted}</span><span>לא רצו {c.notRun}</span>
                        {c.responsible && <span>· אחראי: {c.responsible}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* ── risks ── */}
        <Card padding={4}>
          <div {...box('risks')}>
            <PanelTitle icon="⚠️" title="סיכונים" />
            {(() => {
              const r = data.risks!;
              const nothing = !r.daily && !r.plans.length && !r.blockers.length && !r.manual.length;
              if (nothing) return hist ? <NotManaged /> : <Empty>לא זוהו ולא הוזנו סיכונים ל-CR.</Empty>;
              return (
                <div className="flex flex-col gap-3 text-[13px]">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-subtle-foreground">אוטומטיים</div>
                    {r.daily ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>ניהול QA היומי:</span>
                        <Badge color={RISK_COLOR[r.daily.risk]} bg={C.bgNested}>{RISK_HE[r.daily.risk] ?? r.daily.risk}</Badge>
                        <span className="text-xs text-subtle-foreground">{r.daily.reasons.join(' · ')}{r.daily.tester ? ` · בודק: ${r.daily.tester}` : ''}</span>
                      </div>
                    ) : <div className="text-xs text-subtle-foreground">ניהול QA היומי: אין נתון ל-CR</div>}
                    {r.plans.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span>הערכת הצוותים בתוכנית:</span>
                        {r.plans.map(p => <Badge key={p.team} color={RISK_COLOR[p.level] ?? C.textMuted} bg={C.bgNested}>{p.team}: {RISK_HE[p.level] ?? p.level}</Badge>)}
                      </div>
                    )}
                    {r.blockers.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {r.blockers.map(b => (
                          <div key={b.id} className="flex items-center gap-2 text-xs">
                            <span style={{ color: b.status === 'OPEN' ? C.danger : C.textMuted }}>{b.status === 'OPEN' ? '⛔ חסם פתוח' : '✓ חסם נפתר'}</span>
                            <span className="min-w-0 flex-1 truncate" dir="auto" title={b.title}>{b.title}</span>
                            <span className="shrink-0 text-subtle-foreground">{b.owner ?? ''} · {formatDate(b.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-subtle-foreground">ידניים (הוזנו בניהול סיכונים)</div>
                    {r.manual.length === 0 ? <div className="text-xs text-subtle-foreground">לא הוזנו סיכונים עבור ה-CR</div> : r.manual.map(m => (
                      <div key={m.id} className="mb-1.5 rounded-md border border-border px-2.5 py-1.5" style={{ opacity: m.status === 'CLOSED' ? 0.55 : 1 }}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 font-semibold" dir="auto">{m.title}</span>
                          <Badge color={RISK_COLOR[m.severity] ?? C.textMuted} bg={C.bgNested}>{RISK_HE[m.severity] ?? m.severity}</Badge>
                          <span className="text-xs text-subtle-foreground">{m.status === 'CLOSED' ? 'סגור' : m.status === 'MITIGATED' ? 'בטיפול' : 'פתוח'}</span>
                        </div>
                        {(m.impact || m.mitigation) && <div className="mt-0.5 text-xs text-subtle-foreground" dir="auto">{[m.impact, m.mitigation && `מיטיגציה: ${m.mitigation}`].filter(Boolean).join(' · ')}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>

        {/* ── user tests (UAT) ── */}
        <Card padding={4}>
          <div {...box('uat')}>
            {(() => {
              const u = data.uat!;
              const st = !u.planned ? ['לא תוכננו', C.textMuted] : u.done ? ['✓ בוצעו', C.success] : u.coverage.length ? ['בביצוע', C.warning] : ['טרם החלו', C.warning];
              return (
                <>
                  <PanelTitle icon="👥" title="בדיקות משתמשים (UAT)" right={<Badge color={st[1]} bg={C.bgNested}>{st[0]}</Badge>} />
                  {!u.planned ? <Empty>לא תוכננו בדיקות משתמשים ל-CR בגרסה הזו.</Empty> : (
                    <div className="flex flex-col gap-2 text-[13px]">
                      {u.window && <div className="text-xs text-subtle-foreground">חלון UAT: <span className="inline-block" dir="ltr">{formatDate(u.window.start)}{u.window.end && u.window.end !== u.window.start ? ` – ${formatDate(u.window.end)}` : ''}</span></div>}
                      <div><span className="text-subtle-foreground">בוצעו על ידי: </span>{u.testers.length ? u.testers.join(', ') : '—'}</div>
                      {u.coverage.map(c => (
                        <div key={c.cycleName} className="text-xs text-subtle-foreground">
                          {c.cycleName}: {c.executedPct}% בוצע · עברו {c.passed} · נכשלו {c.failed} · לא רצו {c.notRun}
                        </div>
                      ))}
                      <div>
                        <span className="text-subtle-foreground">תקלות שנפתחו ב-UAT: </span>
                        <Num ids={ids(u.defects)} title={`CR ${cr} — תקלות UAT`} onDrill={onDrill} strong />
                        {u.defects.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-2 text-xs">
                            {groupBy(u.defects, d => d.defectType).map(([type, ds]) => (
                              <span key={type}>{type}: <Num ids={ids(ds)} title={`CR ${cr} — UAT · ${type}`} onDrill={onDrill} /></span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </Card>

        {/* ── test summary ── */}
        <Card padding={4}>
          <PanelTitle icon="📝" title="סיכום בדיקות" />
          {!data.testSummary!.finished
            ? <Empty>⏳ סיכום יוצג בסיום הבדיקות.</Empty>
            : data.testSummary!.text
              ? <div className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-[13px] leading-relaxed text-foreground" dir="auto">{data.testSummary!.text}</div>
              : <div className="text-[13px] font-semibold" style={{ color: C.warning }}>⚠ הבדיקות הסתיימו — לא נכתב סיכום בדיקות.</div>}
        </Card>

        {/* ── deployment plan ── */}
        <Card padding={4}>
          {(() => {
            const p = data.plan!;
            const head = hist ? ['—', C.textMuted] : p.status === 'complete' ? ['✅ הושלמה', C.success] : p.status === 'partial' ? ['◐ חלקית', C.warning] : p.status === 'not-opened' ? ['⛔ לא נפתחה', C.danger] : ['—', C.textMuted];
            const missing = p.teams.filter(x => x.state !== 'approved' && x.state !== 'not-needed');
            return (
              <>
                <PanelTitle icon="🚀" title="תוכנית הטמעה" right={<Badge color={head[1]} bg={C.bgNested}>{head[0]}</Badge>} />
                {hist ? <NotManaged /> : p.status === 'none' ? <Empty>אין צוותים שנדרשת מהם תוכנית הטמעה ל-CR.</Empty> : (
                  <>
                    {p.status === 'partial' && <div className="mb-2 text-xs" style={{ color: C.warning }}>טרם השלימו: {missing.map(x => x.team).join(', ')}</div>}
                    {p.status === 'not-opened' && <div className="mb-2 text-xs" style={{ color: C.danger }}>אף צוות עדיין לא פתח את תוכנית ההטמעה ל-CR.</div>}
                    <table className="w-full border-collapse text-[13px]">
                      <tbody>
                        {p.teams.map(x => (
                          <tr key={x.team} className="border-t border-border">
                            <td className="py-1.5">{x.team}</td>
                            <td className="py-1.5 text-xs font-semibold" style={{ color: PLAN_STATE[x.state][1] }} title={x.returnReason ?? undefined}>
                              {PLAN_STATE[x.state][0]}
                              {x.state === 'approved' && x.approvedBy && <span className="font-normal text-subtle-foreground"> · {x.approvedBy}</span>}
                              {x.state === 'submitted' && x.submittedBy && <span className="font-normal text-subtle-foreground"> · {x.submittedBy}</span>}
                            </td>
                            <td className="py-1.5 text-end">
                              {x.plan && <button onClick={() => setPlanOpen(x.team)} className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">הצג</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {p.teams.some(x => x.plan) && (
                      <button onClick={() => setPlanOpen('*')} className="mt-3 cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-xs font-semibold text-primary">📄 הצג את תוכנית ההטמעה</button>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </Card>

        {/* ── dependencies ── */}
        <Card padding={4}>
          <PanelTitle icon="🔗" title="תלויות" />
          {(() => {
            const d = data.dependencies!;
            if (!d.dependsOn.length && !d.dependedBy.length) return hist ? <NotManaged /> : <Empty>לא הוגדרו תלויות ל-CR בתוכניות ההטמעה.</Empty>;
            const row = (x: Dep, i: number) => (
              <div key={`${x.crNumber}-${i}`} className="flex items-center gap-2 border-t border-border py-1.5 text-[13px]">
                <button onClick={() => onOpenCr(x.crNumber)} className="cursor-pointer border-none bg-transparent p-0 font-semibold text-primary" title="פתח את כרטיס ה-CR">CR {x.crNumber}</button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto" title={x.note ?? x.crLabel}>{x.crLabel || x.note || ''}</span>
                {!x.inVersion ? <span className="text-xs text-subtle-foreground">לא בגרסה</span> : <>
                  <span className="text-xs" style={{ color: x.testsFinished ? C.success : C.textMuted }}>{x.testsFinished ? '✓ נבדק' : x.executedPct != null ? `${x.executedPct}% בוצע` : 'אין בדיקות'}</span>
                  <span className="text-xs text-subtle-foreground">פתוחות: <Num ids={x.openDefectIds} title={`CR ${x.crNumber} — תקלות פתוחות`} onDrill={onDrill} color={C.danger} /></span>
                </>}
              </div>
            );
            return (
              <div className="flex flex-col gap-3">
                {d.dependsOn.length > 0 && <div><div className="mb-1 text-xs font-semibold text-subtle-foreground">ה-CR תלוי ב:</div>{d.dependsOn.map(row)}</div>}
                {d.dependedBy.length > 0 && <div><div className="mb-1 text-xs font-semibold text-subtle-foreground">תלויים ב-CR:</div>{d.dependedBy.map(row)}</div>}
              </div>
            );
          })()}
        </Card>

        {/* ── timeline ── */}
        <Card padding={4}>
          <PanelTitle icon="🗓" title="ציר זמן" />
          {!data.timeline!.length ? <Empty>לא הוגדרו תאריכים לגרסה.</Empty> : (
            <div className="relative flex flex-col gap-0 ps-4">
              <div className="absolute bottom-2 top-2 w-0.5 bg-border" style={{ insetInlineStart: 5 }} />
              {(() => {
                const now = Date.now();
                let nowShown = false;
                return data.timeline!.map(x => {
                  const past = new Date(x.end ?? x.start).getTime() < now;
                  // a one-day milestone (go-live) is "now" only on its day
                  const endOf = x.end ? new Date(x.end).getTime() : new Date(x.start).getTime() + 86400000;
                  const current = new Date(x.start).getTime() <= now && endOf >= now;
                  const showNow = !nowShown && new Date(x.start).getTime() > now;
                  if (showNow) nowShown = true;
                  return (
                    <React.Fragment key={x.key}>
                      {showNow && <div className="relative my-1 text-[11px] font-bold" style={{ color: C.brand }}><span className="absolute h-2 w-2 rounded-full" style={{ insetInlineStart: -14, top: 4, background: C.brand }} />היום · {formatDate(new Date().toISOString())}</div>}
                      <div className="relative py-1.5 text-[13px]" style={{ opacity: past && !current ? 0.6 : 1 }}>
                        <span className="absolute h-2.5 w-2.5 rounded-full border-2" style={{ insetInlineStart: -15, top: 10, borderColor: current ? C.brand : C.border, background: past ? C.border : C.bgCard }} />
                        <span className="font-semibold text-foreground">{x.label}</span>
                        <span className="inline-block text-xs text-subtle-foreground" dir="ltr" style={{ marginRight: 8 }}>{formatDate(x.start)}{x.end && x.end !== x.start ? ` – ${formatDate(x.end)}` : ''}</span>
                        {current && <Badge color={C.brand} bg={C.brandDim} style={{ marginInlineStart: 6 }}>עכשיו</Badge>}
                        {x.mine && <div className="text-xs" style={{ color: C.brand }}>בדיקת ה-CR בסבב: <span className="inline-block" dir="ltr">{formatDate(x.mine.start)} – {formatDate(x.mine.end)}</span>{x.mine.tester && <> · <bdi>{x.mine.tester}</bdi></>}</div>}
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>

      {planOpen && <PlanDialog teams={data.plan!.teams.filter(x => x.plan && (planOpen === '*' || x.team === planOpen))} cr={cr} onClose={() => setPlanOpen(null)} />}
    </div>
  );
};

const PlanDialog: React.FC<{ teams: PlanTeam[]; cr: string; onClose: () => void }> = ({ teams, cr, onClose }) => {
  const block = (label: string, v: string | null) => v ? (
    <div className="mb-2"><div className="text-xs font-semibold text-subtle-foreground">{label}</div><div className="whitespace-pre-wrap text-[13px] text-foreground" dir="auto">{v}</div></div>
  ) : null;
  return (
    <BrandedDialog onClose={onClose} title={`תוכנית הטמעה — CR ${cr}`} icon="🚀" width="lg"
      footer={<DialogButton variant="secondary" onClick={onClose}>סגור</DialogButton>}>
      <div className="flex flex-col gap-4">
        {teams.length === 0 && <div className="text-sm text-subtle-foreground">אין תוכנית כתובה להצגה.</div>}
        {teams.map(t => (
          <div key={t.team} className="rounded-lg p-3" style={{ border: `1px solid ${C.border}` }}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">{t.team}</span>
              <span className="text-xs font-semibold" style={{ color: PLAN_STATE[t.state][1] }}>{PLAN_STATE[t.state][0]}</span>
              {t.riskLevel && <span className="text-xs text-subtle-foreground">· סיכון {RISK_HE[t.riskLevel] ?? t.riskLevel}</span>}
            </div>
            {block('תוכנית עבודה', t.plan!.workPlan)}
            {block('סקריפטים', t.plan!.scripts)}
            {block('זמני ריצה', t.plan!.runTimes)}
            {block('תוכנית חזרה (Rollback)', t.plan!.rollbackPlan)}
            {t.plan!.gradualRollout && block('עלייה מדורגת', t.plan!.gradualDetails || 'כן')}
            {block('בדיקות בליל הגרסה', t.plan!.nightTestingNotes)}
            {block('ניטור בבוקר שאחרי', t.plan!.morningMonitoring)}
            {t.plan!.actions.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-subtle-foreground">פעולות</div>
                {t.plan!.actions.map((a, i) => (
                  <div key={i} className="text-[13px]" dir="auto">• {a.description} <span className="text-xs text-subtle-foreground">({PHASE_HE[a.phase] ?? a.phase}{a.system ? ` · ${a.system}` : ''}{a.ownerName ? ` · ${a.ownerName}` : ''})</span></div>
                ))}
              </div>
            )}
            {t.plan!.monitoring.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-subtle-foreground">נקודות בקרה</div>
                {t.plan!.monitoring.map((m, i) => <div key={i} className="text-[13px]" dir="auto">• {m.type}: {m.name}{m.note ? ` — ${m.note}` : ''}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </BrandedDialog>
  );
};
