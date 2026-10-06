import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { Card } from '../ui';
import { BrandedDialog, DialogButton } from '../ui/BrandedDialog';
import { useDialog } from '../../context/DialogContext';
import {
  DefectsAnalyticsDto, DefectSlaConfig, Dim, DIM_LABELS, DIM_ORDER, TIME_DIMS, SEVERITY_ORDER, AGE_BUCKETS,
  Filters, EMPTY_FILTERS, FILTER_DIMS, activeFilterCount, applyFilters, filterOptions, groupBy, capGroups,
  Group, todayNum, ageOf, isOpen, fmtMonth, fmtDay, trendBuckets, Granularity, countOpenAt, openAtIdx, slaStats, idsOf,
} from './analytics';
import {
  HBarChart, VBarChart, LineChart, PieChart, StackedBarChart, StackRow, TrendBars, BacklogLine, HeatMap,
  colorMap, SEVERITY_CHART_COLOR, OTHER_COLOR,
} from './charts';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Investigation dashboard for the "🐞 תקלות" module (spec 2026-10-06 — see
// memory project-defects-investigation-dashboard-2026-10-06). Everything is
// computed in the browser from one role-scoped dataset; every number drills
// down to exactly the defects behind it (onDrill gets their ids).

type ChartType = 'bar' | 'pie' | 'line' | 'stacked';
type ChartScope = 'all' | 'open' | 'closed';
export interface ChartConfig { id: string; groupBy: Dim; type: ChartType; splitBy: Dim; scope: ChartScope; top10?: boolean }
const CHART_TYPES: { key: ChartType; label: string; icon: string }[] = [
  { key: 'bar', label: 'עמודות', icon: '📊' }, { key: 'pie', label: 'עוגה', icon: '🥧' },
  { key: 'line', label: 'קו', icon: '📈' }, { key: 'stacked', label: 'מוערם', icon: '🧱' },
];
const SCOPE_LABEL: Record<ChartScope, string> = { all: 'כל התקלות', open: 'פתוחות', closed: 'סגורות' };
const MAX_PINNED = 12;
const newId = () => Math.random().toString(36).slice(2, 10);

interface Props {
  token: string;
  role: string;
  onDrill: (title: string, ids: string[]) => void;
  onOpenDefect: (id: string) => void;
  /** Deep link from the testing bug dashboard: start filtered to this release (low environments, like that dashboard). */
  initialRelease?: string;
}

export const DefectsInvestigationDashboard: React.FC<Props> = ({ token, role, onDrill, onOpenDefect, initialRelease }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const dialog = useDialog();
  const [data, setData] = useState<DefectsAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() =>
    initialRelease ? { ...EMPTY_FILTERS, release: [initialRelease], envScope: ['low'] } : EMPTY_FILTERS);
  const [sla, setSla] = useState<DefectSlaConfig | null>(null);
  const [slaEditorOpen, setSlaEditorOpen] = useState(false);
  const [pinned, setPinned] = useState<ChartConfig[]>([]);
  const [chart, setChart] = useState<ChartConfig>({ id: 'main', groupBy: 'system', type: 'bar', splitBy: 'severity', scope: 'all' });
  const [gran, setGran] = useState<Granularity>('month');
  const [heatOpenOnly, setHeatOpenOnly] = useState(true);
  const [topTab, setTopTab] = useState<'system' | 'module' | 'release'>('system');

  const load = useCallback((refresh = false) => {
    setLoading(true); setError(null);
    axios.get(`${API}/qc/defects-analytics`, { headers, params: refresh ? { refresh: 1 } : undefined })
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message || 'שגיאה בטעינת נתוני התקלות'))
      .finally(() => setLoading(false));
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/qc/defects-analytics/sla-config`, { headers }).then(r => setSla(r.data)).catch(() => setSla(null));
    axios.get(`${API}/qc/defects-analytics/layout`, { headers })
      .then(r => setPinned(Array.isArray(r.data?.pinned) ? r.data.pinned : []))
      .catch(() => setPinned([]));
  }, [headers]);

  const savePinned = async (next: ChartConfig[]) => {
    setPinned(next);
    try { await axios.put(`${API}/qc/defects-analytics/layout`, { layout: { pinned: next } }, { headers }); }
    catch { dialog.alert('שמירת הגרפים המוצמדים נכשלה', 'שגיאה', 'danger'); }
  };

  const today = todayNum();
  const idx = useMemo(() => (data ? applyFilters(data, filters) : []), [data, filters]);
  const options = useMemo(() => (data ? filterOptions(data) : null), [data]);

  // Stable colors per dimension (entity → color, from the whole dataset, so a
  // filter never repaints the survivors).
  const globalColors = useMemo(() => {
    const out: Partial<Record<Dim, Record<string, string>>> = {};
    if (!data) return out;
    const all = data.id.map((_, i) => i);
    for (const dim of DIM_ORDER) {
      if (dim === 'severity') { out[dim] = { ...SEVERITY_CHART_COLOR }; continue; }
      out[dim] = colorMap(groupBy(data, all, dim, today).map(g => g.label));
    }
    return out;
  }, [data, today]);

  const drill = (title: string, rowIdx: number[]) => {
    if (!data || rowIdx.length === 0) return;
    onDrill(title, idsOf(data, rowIdx));
  };

  if (loading && !data) return <div className="p-8 text-center text-subtle-foreground">טוען נתוני תקלות…</div>;
  if (error) return <div className="p-8 text-center text-danger">{error}</div>;
  if (!data || !options) return null;

  // ── KPIs ──
  const open = idx.filter(i => isOpen(data, i));
  const closed = idx.filter(i => !isOpen(data, i));
  const sev = (i: number) => data.dict.severity[data.severity[i]] ?? '';
  // Oldest first — the order the (removed, user 2026-10-06) critical table had;
  // the cards' drill-down list is now the place to see them.
  const byAgeDesc = (a: number, b: number) => (ageOf(data, b, today) ?? 0) - (ageOf(data, a, today) ?? 0);
  const ssOpen = open.filter(i => sev(i) === 'Show Stopper').sort(byAgeDesc);
  const severeOpen = open.filter(i => sev(i) === 'Severe').sort(byAgeDesc);
  const monthStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 86400000);
  const newThisMonth = idx.filter(i => (data.detected[i] ?? -1) >= monthStart);
  const idle = (i: number) => today - (data.updated[i] ?? data.detected[i] ?? today);
  const stuck14 = open.filter(i => idle(i) > 14);
  const stuck30 = open.filter(i => idle(i) > 30);
  const stuck60 = open.filter(i => idle(i) > 60);
  const ages = open.map(i => ageOf(data, i, today)).filter((a): a is number => a != null);
  const avgAge = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;
  const slaRes = slaStats(data, idx, sla, today);

  // ── Trend ──
  const count = gran === 'month' ? 12 : gran === 'week' ? 12 : 30;
  const buckets = trendBuckets(data, idx, gran, count, today);
  const periodStart = buckets[0].start, periodEnd = buckets[buckets.length - 1].end;
  const openedInPeriod = buckets.flatMap(b => b.opened);
  const closedInPeriod = buckets.flatMap(b => b.closed);
  const trendPoints = buckets.map(b => ({ label: b.label, opened: b.opened, closed: b.closed, openAtEnd: b.openAtEnd }));

  // ── Aging (open only) ──
  const agingGroups: Group[] = AGE_BUCKETS.map(b => ({
    label: b.label,
    idx: open.filter(i => { const a = ageOf(data, i, today); return a != null && a >= b.min && a <= b.max; }),
  }));

  // ── Heat map: system × severity ──
  const heatBase = heatOpenOnly ? open : idx;
  const heatRows = groupBy(data, heatBase, 'system', today).slice(0, 15);
  const heatCols = SEVERITY_ORDER.filter(s => data.dict.severity.includes(s));
  const heatCell = (r: string, c: string) => (heatRows.find(g => g.label === r)?.idx ?? []).filter(i => sev(i) === c);


  return (
    <div className="flex flex-col gap-4">
      {/* Global filters */}
      <FilterBar filters={filters} setFilters={setFilters} options={options} total={data.id.length} shown={idx.length}
        onRefresh={() => load(true)} generatedAt={data.generatedAt} loading={loading} />

      {data.closeDate.fallback > 0 && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          ℹ️ ל-{data.closeDate.fallback.toLocaleString()} תקלות סגורות לא נמצא מועד סגירה בהיסטוריית הסטטוסים — עבורן נלקח תאריך העדכון האחרון.
        </div>
      )}

      {/* Row 1 — KPIs */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Kpi label="סה״כ תקלות" value={idx.length} onClick={() => drill('כל התקלות', idx)} />
        <Kpi label="פתוחות" value={open.length} color={C.warning} onClick={() => drill('תקלות פתוחות', open)} />
        <Kpi label="סגורות" value={closed.length} color={C.textMuted} onClick={() => drill('תקלות סגורות', closed)} />
        <Kpi label="חדשות החודש" value={newThisMonth.length} color={C.brand} onClick={() => drill('תקלות שנפתחו החודש', newThisMonth)} />
        <Kpi label="Show Stopper פתוחות" value={ssOpen.length} color={SEVERITY_CHART_COLOR['Show Stopper']} onClick={() => drill('Show Stopper פתוחות — מהישנה לחדשה', ssOpen)} />
        <Kpi label="Severe פתוחות" value={severeOpen.length} color={SEVERITY_CHART_COLOR.Severe} onClick={() => drill('Severe פתוחות — מהישנה לחדשה', severeOpen)} />
        <Kpi label="תקועות — ללא עדכון מעל 30 יום" value={stuck30.length} color={C.danger} onClick={() => drill('פתוחות ללא עדכון מעל 30 יום', stuck30)}
          sub={<><SubLink n={stuck14.length} label=">14" onClick={() => drill('פתוחות ללא עדכון מעל 14 יום', stuck14)} /> · <SubLink n={stuck60.length} label=">60" onClick={() => drill('פתוחות ללא עדכון מעל 60 יום', stuck60)} /></>} />
        <Kpi label="גיל ממוצע (פתוחות)" value={avgAge ?? '—'} suffix={avgAge != null ? 'ימים' : undefined} />
        <SlaKpi res={slaRes} cfg={sla} isAdmin={role === 'ADMIN'} onEdit={() => setSlaEditorOpen(true)}
          onBreaches={() => slaRes && drill('חריגות SLA', slaRes.breached)} />
      </div>

      {/* Row 2 — trend + backlog (one chart family, item 2 + 9 merged) */}
      <Card padding={4}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-bold text-foreground">📈 מגמה — נפתחו מול נסגרו, ו-Backlog</div>
          <Segmented value={gran} onChange={v => setGran(v as Granularity)}
            options={[{ value: 'month', label: 'חודש (12)' }, { value: 'week', label: 'שבוע (12)' }, { value: 'day', label: 'יום (30)' }]} />
        </div>
        <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <MiniStat label={`פתוחות בתחילת התקופה (${fmtDay(periodStart)})`} value={countOpenAt(data, idx, periodStart)} onClick={() => drill('פתוחות בתחילת התקופה', openAtIdx(data, idx, periodStart))} />
          <MiniStat label="נפתחו בתקופה" value={openedInPeriod.length} onClick={() => drill('נפתחו בתקופה', openedInPeriod)} />
          <MiniStat label="נסגרו בתקופה" value={closedInPeriod.length} onClick={() => drill('נסגרו בתקופה', closedInPeriod)} />
          <MiniStat label="פתוחות בסוף התקופה" value={countOpenAt(data, idx, periodEnd)} onClick={() => drill('פתוחות בסוף התקופה', openAtIdx(data, idx, periodEnd))} />
        </div>
        <TrendBars points={trendPoints} onPick={drill} />
        <div className="mb-1 mt-4 text-xs font-semibold text-subtle-foreground">Backlog — פתוחות בסוף כל תקופה</div>
        <BacklogLine points={trendPoints} onPick={p => {
          const b = buckets.find(x => x.label === p.label);
          if (b) drill(`פתוחות בסוף ${p.label}`, openAtIdx(data, idx, b.end));
        }} />
      </Card>

      {/* Row 3 — dynamic chart + aging */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3"><Card padding={4}>
          <ChartControls cfg={chart} setCfg={setChart}
            onPin={() => {
              if (pinned.length >= MAX_PINNED) { dialog.alert(`ניתן להצמיד עד ${MAX_PINNED} גרפים`, 'הגבלה', 'warning'); return; }
              savePinned([...pinned, { ...chart, id: newId() }]);
            }} />
          <DynamicChart data={data} idx={idx} cfg={chart} colors={globalColors} onDrill={drill} today={today} />
        </Card></div>
        <div className="min-w-0 xl:col-span-2"><Card padding={4}>
          <div className="mb-3 text-sm font-bold text-foreground">⏳ Aging — תקלות פתוחות לפי גיל</div>
          <VBarChart groups={agingGroups} onPick={g => drill(`פתוחות בגיל ${g.label}`, g.idx)} color={SEVERITY_CHART_COLOR.Severe} height={240} />
          <div className="mt-2 text-xs text-subtle-foreground">גיל = ימים מאז הפתיחה. {open.length.toLocaleString()} פתוחות בסינון הנוכחי.</div>
        </Card></div>
      </div>

      {/* My pinned charts */}
      {pinned.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">📌 הגרפים שלי <span className="text-xs font-normal text-subtle-foreground">· נשמרים לחשבון שלך · {pinned.length}/{MAX_PINNED}</span></div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 440px), 1fr))' }}>
            {pinned.map(p => (
              <Card key={p.id} padding={4}>
                <div className="mb-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {p.top10 ? 'Top 10 · ' : ''}{DIM_LABELS[p.groupBy]}{p.type === 'stacked' ? ` × ${DIM_LABELS[p.splitBy]}` : ''}
                    <span className="ms-1.5 text-xs font-normal text-subtle-foreground">{SCOPE_LABEL[p.scope]} · {CHART_TYPES.find(t => t.key === p.type)?.label}</span>
                  </div>
                  <button title="פתח בגרף הראשי" onClick={() => { setChart({ ...p, id: 'main' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">⤢</button>
                  <button title="הסר מהגרפים שלי" onClick={() => savePinned(pinned.filter(x => x.id !== p.id))}
                    className="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-danger">✕</button>
                </div>
                <DynamicChart data={data} idx={idx} cfg={p} colors={globalColors} onDrill={drill} today={today} compact />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Row 4 — heat map */}
      <Card padding={4}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-bold text-foreground">🔥 Heat Map — מערכת × חומרה</div>
          <Segmented value={heatOpenOnly ? 'open' : 'all'} onChange={v => setHeatOpenOnly(v === 'open')}
            options={[{ value: 'open', label: 'פתוחות' }, { value: 'all', label: 'כל התקלות' }]} />
          <span className="text-xs text-subtle-foreground">15 המערכות עם הכי הרבה תקלות · כהה יותר = יותר תקלות</span>
        </div>
        <HeatMap rows={heatRows.map(g => g.label)} cols={heatCols} cell={heatCell} onPick={drill} colColors={SEVERITY_CHART_COLOR} />
      </Card>

      {/* Row 5 — top 10 */}
      <Card padding={4}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-bold text-foreground">🏆 Top 10</div>
          <Segmented value={topTab} onChange={v => setTopTab(v as any)}
            options={[{ value: 'system', label: 'מערכות' }, { value: 'module', label: 'מודולים' }, { value: 'release', label: 'גרסאות' }]} />
        </div>
        <HBarChart groups={groupBy(data, idx, topTab, today).filter(g => !g.label.startsWith('ללא')).slice(0, 10)} total={idx.length}
          onPick={g => drill(`${DIM_LABELS[topTab]}: ${g.label}`, g.idx)} />
      </Card>


      {slaEditorOpen && (
        <SlaEditor cfg={sla} severities={heatCols.length ? heatCols : SEVERITY_ORDER} headers={headers}
          onClose={() => setSlaEditorOpen(false)} onSaved={c => { setSla(c); setSlaEditorOpen(false); }} />
      )}
    </div>
  );
};

// ── Dynamic chart ────────────────────────────────────────────────────────────
const DynamicChart: React.FC<{
  data: DefectsAnalyticsDto; idx: number[]; cfg: ChartConfig; today: number; compact?: boolean;
  colors: Partial<Record<Dim, Record<string, string>>>; onDrill: (title: string, idx: number[]) => void;
}> = ({ data, idx, cfg, today, compact, colors, onDrill }) => {
  const scoped = cfg.scope === 'all' ? idx : idx.filter(i => (cfg.scope === 'open') === isOpen(data, i));
  let groups = groupBy(data, scoped, cfg.groupBy, today);
  if (cfg.top10) groups = [...groups].sort((a, b) => b.idx.length - a.idx.length).slice(0, 10);
  const isTime = TIME_DIMS.has(cfg.groupBy);
  const ordinal = isTime || cfg.groupBy === 'age';
  const type: ChartType = cfg.type === 'line' && !isTime ? 'bar' : cfg.type;
  const fmt = isTime ? (l: string) => (/^\d{4}-\d{2}$/.test(l) ? fmtMonth(l) : l) : undefined;
  const title = (g: Group) => `${DIM_LABELS[cfg.groupBy]}: ${fmt ? fmt(g.label) : g.label}${cfg.scope !== 'all' ? ` (${SCOPE_LABEL[cfg.scope]})` : ''}`;
  const pick = (g: Group) => onDrill(title(g), g.idx);
  const maxH = compact ? 260 : 360;

  if (type === 'line') return <LineChart groups={groups} onPick={pick} labelFmt={fmt} height={compact ? 200 : 240} />;
  if (type === 'pie') {
    const capped = capGroups(ordinal ? groups : [...groups].sort((a, b) => b.idx.length - a.idx.length), 8);
    const map = { ...(colors[cfg.groupBy] ?? {}) };
    capped.forEach(g => { if (!map[g.label]) map[g.label] = OTHER_COLOR; });
    return <PieChart groups={capped} total={scoped.length} colors={map} onPick={pick} />;
  }
  if (type === 'stacked') {
    const splitDim = cfg.splitBy === cfg.groupBy ? (cfg.groupBy === 'severity' ? 'status' : 'severity') : cfg.splitBy;
    const splitGlobal = groupBy(data, scoped, splitDim, today);
    const keepSplit = (ordinalDim(splitDim) ? splitGlobal : [...splitGlobal].sort((a, b) => b.idx.length - a.idx.length)).slice(0, 7).map(g => g.label);
    const rowsBase = ordinal ? groups : capGroups(groups, 15);
    const rows: StackRow[] = rowsBase.map(g => {
      const parts = groupBy(data, g.idx, splitDim, today);
      const kept = parts.filter(p => keepSplit.includes(p.label)).sort((a, b) => keepSplit.indexOf(a.label) - keepSplit.indexOf(b.label));
      const restIdx = parts.filter(p => !keepSplit.includes(p.label)).flatMap(p => p.idx);
      return { label: fmt ? fmt(g.label) : g.label, idx: g.idx, parts: restIdx.length ? [...kept, { label: 'אחר', idx: restIdx }] : kept };
    });
    const splitLabels = [...keepSplit, ...(rows.some(r => r.parts.some(p => p.label === 'אחר')) ? ['אחר'] : [])];
    const map = { ...(colors[splitDim] ?? {}), אחר: OTHER_COLOR };
    return <StackedBarChart rows={rows} colors={map} splitLabels={splitLabels} maxHeight={maxH}
      onPick={(t, ids) => onDrill(`${DIM_LABELS[cfg.groupBy]}: ${t}`, ids)} />;
  }
  if (ordinal) return <VBarChart groups={groups} onPick={pick} labelFmt={fmt} height={compact ? 200 : 240} />;
  return <HBarChart groups={cfg.top10 ? groups : capGroups(groups, 25)} total={scoped.length} onPick={pick} maxHeight={maxH} />;
};
const ordinalDim = (d: Dim) => d === 'severity' || d === 'age' || TIME_DIMS.has(d);

const ChartControls: React.FC<{ cfg: ChartConfig; setCfg: (c: ChartConfig) => void; onPin: () => void }> = ({ cfg, setCfg, onPin }) => {
  const isTime = TIME_DIMS.has(cfg.groupBy);
  const sel = 'rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground';
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-foreground">📊 הצג לפי</span>
      <select value={cfg.groupBy} onChange={e => {
        const g = e.target.value as Dim;
        setCfg({ ...cfg, groupBy: g, type: cfg.type === 'line' && !TIME_DIMS.has(g) ? 'bar' : cfg.type });
      }} className={sel}>
        {DIM_ORDER.map(d => <option key={d} value={d}>{DIM_LABELS[d]}</option>)}
      </select>
      <div className="flex overflow-hidden rounded-md border border-border">
        {CHART_TYPES.map(t => {
          const disabled = t.key === 'line' && !isTime;
          return (
            <button key={t.key} disabled={disabled} onClick={() => setCfg({ ...cfg, type: t.key })}
              title={disabled ? 'גרף קו זמין רק לחתך לפי חודש פתיחה/סגירה' : t.label}
              className={`border-none px-2.5 py-1 text-xs ${cfg.type === t.key ? 'bg-primary font-bold text-white' : 'bg-card text-muted-foreground'} ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>
      {cfg.type === 'stacked' && (
        <>
          <span className="text-xs text-subtle-foreground">פילוח לפי</span>
          <select value={cfg.splitBy} onChange={e => setCfg({ ...cfg, splitBy: e.target.value as Dim })} className={sel}>
            {DIM_ORDER.filter(d => d !== cfg.groupBy).map(d => <option key={d} value={d}>{DIM_LABELS[d]}</option>)}
          </select>
        </>
      )}
      <select value={cfg.scope} onChange={e => setCfg({ ...cfg, scope: e.target.value as ChartScope })} className={sel}>
        {(Object.keys(SCOPE_LABEL) as ChartScope[]).map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
      </select>
      <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={!!cfg.top10} onChange={e => setCfg({ ...cfg, top10: e.target.checked })} /> Top 10
      </label>
      <button onClick={onPin} className="ms-auto cursor-pointer rounded-md border border-primary/40 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary"
        title="הוסף את הגרף הזה ל'הגרפים שלי' — נשמר לחשבון שלך">
        📌 הצמד
      </button>
    </div>
  );
};

// ── Filters ──────────────────────────────────────────────────────────────────
const FilterBar: React.FC<{
  filters: Filters; setFilters: (f: Filters) => void; options: ReturnType<typeof filterOptions>;
  total: number; shown: number; onRefresh: () => void; generatedAt: string; loading: boolean;
}> = ({ filters, setFilters, options, total, shown, onRefresh, generatedAt, loading }) => {
  const [openKey, setOpenKey] = useState<keyof Filters | null>(null);
  const n = activeFilterCount(filters);
  return (
    <Card padding={3}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-subtle-foreground">סביבה:</span>
        <Segmented
          value={filters.envScope[0] ?? 'all'}
          onChange={v => setFilters({ ...filters, envScope: v === 'all' ? [] : [v as 'low' | 'prod'] })}
          options={[{ value: 'all', label: 'הכל' }, { value: 'low', label: 'סביבות נמוכות' }, { value: 'prod', label: 'ייצור' }]}
        />
        <span className="mx-1 h-5 w-px bg-border" />
        <span className="text-xs font-bold text-subtle-foreground">סינון:</span>
        {FILTER_DIMS.map(f => (
          <MultiSelect key={f.key} label={f.label} values={filters[f.key] as (string | number)[]} options={options[f.key]}
            open={openKey === f.key} setOpen={o => setOpenKey(o ? f.key : null)}
            onChange={vals => setFilters({ ...filters, [f.key]: vals } as Filters)} />
        ))}
        {n > 0 && <button onClick={() => setFilters(EMPTY_FILTERS)} className="cursor-pointer border-none bg-transparent text-xs font-semibold text-primary">נקה הכל ({n})</button>}
        <span className="ms-auto text-xs text-subtle-foreground">
          {shown.toLocaleString()} מתוך {total.toLocaleString()} תקלות · עודכן {new Date(generatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <button onClick={onRefresh} disabled={loading} title="טען מחדש מ-QC"
          className="cursor-pointer rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground disabled:opacity-50">{loading ? '…' : '⟳'}</button>
      </div>
    </Card>
  );
};

const MultiSelect: React.FC<{
  label: string; values: (string | number)[]; options: { value: string | number; label: string }[];
  open: boolean; setOpen: (o: boolean) => void; onChange: (v: (string | number)[]) => void;
}> = ({ label, values, options, open, setOpen, onChange }) => {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, setOpen]);
  const active = values.length > 0;
  const shownOpts = options.filter(o => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${active ? 'border-primary bg-primary-50 font-bold text-primary' : 'border-border bg-card text-foreground'}`}>
        {label}{active ? `: ${values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? values[0]) : values.length}` : ''} ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 flex max-h-[340px] w-[240px] flex-col rounded-md border border-border bg-card p-2 shadow-lg">
          {options.length > 8 && (
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש…" className="mb-1.5 rounded-sm border border-border px-2 py-1 text-xs" />
          )}
          <div className="flex flex-col gap-1 overflow-y-auto">
            {shownOpts.map(o => (
              <label key={String(o.value)} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input type="checkbox" checked={values.includes(o.value)}
                  onChange={() => onChange(values.includes(o.value) ? values.filter(v => v !== o.value) : [...values, o.value])} />
                <span className="truncate" title={o.label}>{o.label}</span>
              </label>
            ))}
            {shownOpts.length === 0 && <div className="text-xs text-subtle-foreground">אין ערכים</div>}
          </div>
          {active && <button onClick={() => onChange([])} className="mt-1.5 cursor-pointer border-none bg-transparent text-right text-xs text-primary">נקה</button>}
        </div>
      )}
    </div>
  );
};

// ── Small pieces ─────────────────────────────────────────────────────────────
const Kpi: React.FC<{ label: string; value: number | string; color?: string; suffix?: string; sub?: React.ReactNode; onClick?: () => void }> = ({ label, value, color, suffix, sub, onClick }) => (
  <div onClick={onClick} role={onClick ? 'button' : undefined}
    className={`rounded-lg border border-border bg-card px-3.5 py-3 ${onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}>
    <div className="text-xs leading-snug text-subtle-foreground">{label}</div>
    <div className="mt-1 text-[24px] font-bold leading-tight tabular-nums" style={{ color: color ?? C.textPrimary }}>
      {typeof value === 'number' ? value.toLocaleString() : value}{suffix && <span className="ms-1 text-xs font-normal text-subtle-foreground">{suffix}</span>}
    </div>
    {sub && <div className="mt-0.5 text-xs text-subtle-foreground" onClick={e => e.stopPropagation()}>{sub}</div>}
  </div>
);
const SubLink: React.FC<{ n: number; label: string; onClick: () => void }> = ({ n, label, onClick }) => (
  <button onClick={onClick} className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-primary">{label}: <b className="tabular-nums">{n.toLocaleString()}</b></button>
);
const MiniStat: React.FC<{ label: string; value: number; onClick?: () => void }> = ({ label, value, onClick }) => (
  <button onClick={onClick} className="cursor-pointer rounded-md border border-border bg-muted px-3 py-2 text-right">
    <div className="text-[11px] leading-snug text-subtle-foreground">{label}</div>
    <div className="text-lg font-bold tabular-nums text-foreground">{value.toLocaleString()}</div>
  </button>
);
const Segmented: React.FC<{ value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> = ({ value, onChange, options }) => (
  <div className="flex overflow-hidden rounded-md border border-border">
    {options.map(o => (
      <button key={o.value} onClick={() => onChange(o.value)}
        className={`cursor-pointer border-none px-2.5 py-1 text-xs ${value === o.value ? 'bg-primary font-bold text-white' : 'bg-card text-muted-foreground'}`}>
        {o.label}
      </button>
    ))}
  </div>
);

const SlaKpi: React.FC<{ res: ReturnType<typeof slaStats>; cfg: DefectSlaConfig | null; isAdmin: boolean; onEdit: () => void; onBreaches: () => void }> = ({ res, cfg, isAdmin, onEdit, onBreaches }) => {
  if (!cfg?.enabled || !res) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-3.5 py-3">
        <div className="text-xs text-subtle-foreground">SLA</div>
        <div className="mt-1 text-sm font-semibold text-subtle-foreground">טרם הוגדר</div>
        {isAdmin && <button onClick={onEdit} className="mt-0.5 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">הגדר יעדים ←</button>}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex items-center justify-between text-xs text-subtle-foreground">
        <span>עמידה ב-SLA</span>
        {isAdmin && <button onClick={onEdit} title="הגדרות SLA" className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-primary">⚙</button>}
      </div>
      <div className="mt-1 text-[24px] font-bold leading-tight tabular-nums" style={{ color: (res.pct ?? 100) >= 90 ? C.success : C.danger }}>
        {res.pct == null ? '—' : `${res.pct}%`}
      </div>
      <button onClick={onBreaches} className="mt-0.5 cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-primary">
        חריגות: <b className="tabular-nums">{res.breached.length.toLocaleString()}</b> מתוך {res.considered.toLocaleString()}
      </button>
    </div>
  );
};

const SlaEditor: React.FC<{ cfg: DefectSlaConfig | null; severities: string[]; headers: any; onClose: () => void; onSaved: (c: DefectSlaConfig) => void }> = ({ cfg, severities, headers, onClose, onSaved }) => {
  const [enabled, setEnabled] = useState(!!cfg?.enabled);
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(severities.map(s => [s, cfg?.targetDays?.[s] != null ? String(cfg.targetDays[s]) : ''])));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const res = await axios.put(`${API}/qc/defects-analytics/sla-config`, {
        enabled, targetDays: Object.fromEntries(severities.map(s => [s, days[s] ? Number(days[s]) : null])),
      }, { headers });
      onSaved(res.data);
    } catch (e: any) { setErr(e?.response?.data?.message || 'השמירה נכשלה'); setSaving(false); }
  };
  return (
    <BrandedDialog onClose={onClose} title="הגדרות SLA לתקלות" icon="⏱" width="sm" busy={saving} closeOnBackdrop={false}
      footer={<><DialogButton onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור'}</DialogButton><DialogButton variant="secondary" onClick={onClose} disabled={saving}>ביטול</DialogButton></>}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted-foreground">יעד בימים לכל חומרה. השעון נעצר כשהתקלה נסגרת (מועד הסגירה מהיסטוריית הסטטוסים). חומרה בלי יעד לא נכללת בחישוב.</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> הפעל מדידת SLA
        </label>
        {severities.map(s => (
          <label key={s} className="flex items-center justify-between gap-3 text-sm text-foreground">
            <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_CHART_COLOR[s] ?? OTHER_COLOR }} />{s}</span>
            <span className="flex items-center gap-1.5">
              <input type="number" min={1} value={days[s] ?? ''} onChange={e => setDays(d => ({ ...d, [s]: e.target.value }))}
                className="w-20 rounded-md border border-border px-2 py-1 text-sm" placeholder="—" />
              <span className="text-xs text-subtle-foreground">ימים</span>
            </span>
          </label>
        ))}
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>
    </BrandedDialog>
  );
};
