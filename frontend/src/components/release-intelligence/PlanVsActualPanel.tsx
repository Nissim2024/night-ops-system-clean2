import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { formatDate } from '../../utils/dateFormat';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { PersonAvatar } from '../shared/defectFieldDisplay';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Plan vs actual scenario execution (spec 2026-10-03) — "expected" comes from
// the QA work plan (each CR's task window, scenarios spread over its work
// days, counted through end of yesterday), "actual" from QC. Three levels:
// summary across all CRs, per CR, per tester (incl. the tester's defect load).

type PvaStatus = 'AHEAD' | 'ON_TRACK' | 'AT_RISK' | 'BEHIND' | 'NOT_STARTED' | 'NO_SCENARIOS';
interface PvaTotals {
  total: number; expected: number; executed: number; passed: number;
  gap: number; gapPct: number | null; status: PvaStatus;
  plannedToday: number; executedToday: number | null;
}
interface PvaCr extends PvaTotals {
  crNumber: string; crLabel: string; testerId: string; tester: string;
  windowStart: string; windowEnd: string;
}
interface PvaTester extends PvaTotals {
  testerId: string; tester: string; crCount: number;
  crs: { crNumber: string; crLabel: string; status: PvaStatus; expected: number; executed: number; total: number }[];
  defects: { reported: number; stillOpen: number; awaitingRetest: number; targetAwaitingRetest: number };
}
interface PlanVsActual {
  cycles: { cycleType: string; plannedStart: string; plannedEnd: string }[];
  cycleType: string | null;
  todayIsWorkDay: boolean;
  todayDataAvailable: boolean;
  summary: PvaTotals & { crCount: number };
  crs: PvaCr[];
  testers: PvaTester[];
}

const STATUS_META: Record<PvaStatus, { label: string; color: string }> = {
  AHEAD:        { label: 'מקדים',      color: C.success },
  ON_TRACK:     { label: 'בקצב',       color: C.success },
  AT_RISK:      { label: 'בסיכון',     color: C.warning },
  BEHIND:       { label: 'בפיגור',     color: C.danger },
  NOT_STARTED:  { label: 'טרם התחיל', color: C.textMuted },
  NO_SCENARIOS: { label: 'אין תרחישים', color: C.textMuted },
};
const CYCLE_LABEL: Record<string, string> = { CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3' };

const thClass = 'whitespace-nowrap border-b border-border px-2.5 py-2 text-right text-xs font-semibold text-subtle-foreground';
const tdClass = 'border-b border-border px-2.5 py-2 text-sm text-foreground [font-variant-numeric:tabular-nums]';

function StatusBadge({ status }: { status: PvaStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: m.color, background: `${m.color}1A` }}>
      {m.label}
    </span>
  );
}

function GapCell({ gap, gapPct }: { gap: number; gapPct: number | null }) {
  const color = gapPct == null ? C.textMuted : gapPct <= -20 ? C.danger : gapPct <= -10 ? C.warning : C.success;
  return (
    <span dir="ltr" className="inline-block whitespace-nowrap font-semibold" style={{ color }}>
      {gap > 0 ? '+' : ''}{gap}{gapPct != null && <span className="font-normal text-subtle-foreground"> ({gapPct > 0 ? '+' : ''}{gapPct}%)</span>}
    </span>
  );
}

function TodayCell({ executedToday, plannedToday, todayIsWorkDay, compact }: { executedToday: number | null; plannedToday: number; todayIsWorkDay: boolean; compact?: boolean }) {
  if (!todayIsWorkDay) return <span className="whitespace-nowrap text-subtle-foreground" title="היום אינו יום עבודה">{compact ? '—' : 'לא יום עבודה'}</span>;
  if (plannedToday === 0 && !executedToday) return <span className="text-subtle-foreground">—</span>;
  if (executedToday == null) return <span className="text-subtle-foreground">? / {plannedToday}</span>;
  const color = executedToday >= plannedToday ? C.success : executedToday === 0 ? C.danger : C.warning;
  return <span dir="ltr" className="inline-block whitespace-nowrap font-semibold" style={{ color }}>{executedToday} / {plannedToday}</span>;
}

// Executed vs expected vs total on one bar: filled = executed, marker = expected.
function PlanBar({ executed, expected, total }: { executed: number; expected: number; total: number }) {
  if (total <= 0) return null;
  const exe = Math.min(100, (executed / total) * 100);
  const exp = Math.min(100, (expected / total) * 100);
  const color = executed >= expected ? C.success : expected > 0 && (expected - executed) / expected >= 0.2 ? C.danger : C.warning;
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-sm bg-muted" title={`הורץ ${executed} · מצופה ${expected} · סה״כ ${total}`}>
      <div className="h-full rounded-sm" style={{ width: `${exe}%`, background: color }} />
      <div className="absolute bottom-0 top-0 w-0.5 bg-foreground" style={{ insetInlineStart: `${exp}%` }} />
    </div>
  );
}

function SummaryCard({ value, label, sub, color }: { value: React.ReactNode; label: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-[130px] flex-1 basis-[130px] rounded-lg border border-border bg-card px-[18px] py-3.5" style={{ borderTop: color ? `3px solid ${color}` : undefined }}>
      <div className="text-xl font-bold leading-[1.2]" style={{ color: color ?? C.textPrimary }}>{value}</div>
      <div className="mt-[3px] text-xs text-subtle-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-subtle-foreground">{sub}</div>}
    </div>
  );
}

export const PlanVsActualPanel: React.FC<{ token: string; versionId: string }> = ({ token, versionId }) => {
  const [cycle, setCycle] = useState<string | null>(null);
  const [data, setData] = useState<PlanVsActual | null>(null);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<'CR' | 'TESTER'>('CR');
  const [expandedTester, setExpandedTester] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{ value: string; title: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/release-intelligence/daily-qa/${versionId}/plan-vs-actual`, {
      headers: { Authorization: `Bearer ${token}` },
      params: cycle ? { cycle } : undefined,
    })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [versionId, cycle, token]);

  if (loading && !data) return <div className="text-sm text-subtle-foreground">טוען תכנון מול ביצוע…</div>;
  if (!data) return null;

  const s = data.summary;
  const header = (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-subtle-foreground">📈 תכנון מול ביצוע — הרצת תרחישים</h2>
      <div className="flex flex-wrap items-center gap-2">
        {data.cycles.length > 1 && (
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {data.cycles.map(c => (
              <button
                key={c.cycleType}
                onClick={() => setCycle(c.cycleType)}
                className={cn('cursor-pointer rounded-sm border-none px-3 py-1 text-xs font-semibold', data.cycleType === c.cycleType ? 'bg-card text-foreground' : 'bg-transparent text-subtle-foreground')}
                title={`${formatDate(c.plannedStart)} – ${formatDate(c.plannedEnd)}`}
              >
                {CYCLE_LABEL[c.cycleType] ?? c.cycleType}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
          {([['CR', 'לפי CR'], ['TESTER', 'לפי בודק']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setLevel(k)}
              className={cn('cursor-pointer rounded-sm border-none px-3 py-1 text-xs font-semibold', level === k ? 'bg-card text-foreground' : 'bg-transparent text-subtle-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (!data.cycleType || data.crs.length === 0) {
    return (
      <div id="daily-plan-vs-actual">
        {header}
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-subtle-foreground">
          אין תוכנית עבודה עם משימות CR לסבב זה — לא ניתן לחשב תכנון מול ביצוע.
        </div>
      </div>
    );
  }

  return (
    <div id="daily-plan-vs-actual" className="flex flex-col gap-2.5">
      {header}

      {/* ── Summary across all CRs in the cycle ── */}
      <div className="flex flex-wrap gap-3">
        <SummaryCard value={<StatusBadge status={s.status} />} label={`סטטוס — ${CYCLE_LABEL[data.cycleType] ?? data.cycleType}`} sub={`${s.crCount} CR-ים בתוכנית`} color={STATUS_META[s.status].color} />
        <SummaryCard value={s.expected} label="מצופה עד היום (לפי התוכנית)" sub={`מתוך ${s.total} תרחישים`} />
        <SummaryCard value={s.executed} label="הורץ בפועל" sub={`${s.passed} עברו`} />
        <SummaryCard value={<GapCell gap={s.gap} gapPct={s.gapPct} />} label="פער מהתוכנית" />
        <SummaryCard
          value={<TodayCell executedToday={s.executedToday} plannedToday={s.plannedToday} todayIsWorkDay={data.todayIsWorkDay} />}
          label="היום: הורץ / מתוכנן"
          sub={data.todayDataAvailable ? undefined : 'אין צילום מאתמול — ריצת היום תחושב מהלילה'}
        />
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <PlanBar executed={s.executed} expected={s.expected} total={s.total} />
        <div className="mt-1 text-[11px] text-subtle-foreground">המילוי = הורץ בפועל · הקו השחור = המצופה עד היום לפי תוכנית העבודה</div>
      </div>

      {/* ── Per CR ── */}
      {level === 'CR' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['CR', 'בודק', 'חלון בתוכנית', 'סה״כ', 'מצופה', 'הורץ', 'עברו', 'פער', 'היום', '', 'סטטוס'].map((h, i) => <th key={i} className={thClass}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.crs.map(cr => (
                <tr key={cr.crNumber} onClick={() => setDrilldown({ value: cr.crNumber, title: `תקלות פתוחות — CR ${cr.crNumber}` })} className="cursor-pointer hover:bg-muted">
                  <td className={cn(tdClass, 'max-w-[260px] truncate font-semibold')} title={cr.crLabel}>{cr.crLabel}</td>
                  <td className={tdClass}>{cr.tester && cr.tester !== '—' ? <PersonAvatar name={cr.tester} full /> : '—'}</td>
                  <td className={cn(tdClass, 'whitespace-nowrap text-xs text-subtle-foreground')}>{formatDate(cr.windowStart)} – {formatDate(cr.windowEnd)}</td>
                  <td className={tdClass}>{cr.total}</td>
                  <td className={tdClass}>{cr.expected}</td>
                  <td className={tdClass}>{cr.executed}</td>
                  <td className={tdClass}>{cr.passed}</td>
                  <td className={tdClass}><GapCell gap={cr.gap} gapPct={cr.gapPct} /></td>
                  <td className={tdClass}><TodayCell executedToday={cr.executedToday} plannedToday={cr.plannedToday} todayIsWorkDay={data.todayIsWorkDay} compact /></td>
                  <td className={cn(tdClass, 'w-[120px]')}><PlanBar executed={cr.executed} expected={cr.expected} total={cr.total} /></td>
                  <td className={tdClass}><StatusBadge status={cr.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Per tester (incl. defect load) ── */}
      {level === 'TESTER' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['בודק', 'CR-ים', 'מצופה', 'הורץ', 'פער', 'היום', 'תקלות שפתח (פתוחות)', 'ממתינות לאימות שלו (TARGET)', 'סטטוס'].map(h => <th key={h} className={thClass}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.testers.map(t => (
                <React.Fragment key={t.testerId}>
                  <tr onClick={() => setExpandedTester(v => v === t.testerId ? null : t.testerId)} className="cursor-pointer hover:bg-muted">
                    <td className={cn(tdClass, 'font-semibold')}>{t.tester !== '—' ? <PersonAvatar name={t.tester} full /> : '—'}</td>
                    <td className={tdClass}>{t.crCount}</td>
                    <td className={tdClass}>{t.expected}</td>
                    <td className={tdClass}>{t.executed}</td>
                    <td className={tdClass}><GapCell gap={t.gap} gapPct={t.gapPct} /></td>
                    <td className={tdClass}><TodayCell executedToday={t.executedToday} plannedToday={t.plannedToday} todayIsWorkDay={data.todayIsWorkDay} compact /></td>
                    <td className={tdClass}>{t.defects.reported} <span className="text-subtle-foreground">({t.defects.stillOpen})</span></td>
                    <td className={tdClass} style={{ color: t.defects.awaitingRetest + t.defects.targetAwaitingRetest > 0 ? C.warning : C.textPrimary }}>
                      {t.defects.awaitingRetest + t.defects.targetAwaitingRetest}
                      {t.defects.targetAwaitingRetest > 0 && <span className="text-subtle-foreground"> ({t.defects.targetAwaitingRetest} TARGET)</span>}
                    </td>
                    <td className={tdClass}><StatusBadge status={t.status} /></td>
                  </tr>
                  {expandedTester === t.testerId && (
                    <tr>
                      <td colSpan={9} className="border-b border-border bg-muted px-2.5 pb-3 pt-1">
                        <div className="flex flex-col gap-1">
                          {t.crs.map(cr => (
                            <div
                              key={cr.crNumber}
                              onClick={() => setDrilldown({ value: cr.crNumber, title: `תקלות פתוחות — CR ${cr.crNumber}` })}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-card"
                            >
                              <span className="truncate">{cr.crLabel}</span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span>{cr.executed} / {cr.expected} מצופה ({cr.total} סה״כ)</span>
                                <StatusBadge status={cr.status} />
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drilldown && (
        <DefectDrilldownModal
          token={token}
          versionId={versionId}
          screen="daily-qa"
          filter="cr"
          value={drilldown.value}
          title={drilldown.title}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
};
