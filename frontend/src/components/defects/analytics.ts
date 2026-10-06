// Client-side engine of the defects investigation dashboard (2026-10-06).
// The server sends one compact, role-scoped dataset (GET /qc/defects-analytics,
// columnar + dictionary-encoded, dates as UTC day numbers); everything below
// is pure functions over row INDEXES, so every chart can hand the exact ids
// behind a number to the drill-down (POST /qc/defects-by-ids).

export interface DefectsAnalyticsDto {
  generatedAt: string;
  mock: boolean;
  closeDate: { fromHistory: number; fallback: number };
  dict: { status: string[]; severity: string[]; team: string[]; system: string[]; module: string[]; release: string[]; person: string[]; env: string[] };
  id: number[];
  env: number[];
  status: number[];
  severity: number[];
  teams: number[][];
  system: number[];
  module: number[];
  release: number[];
  owner: number[];
  creator: number[];
  detected: (number | null)[];
  closed: (number | null)[];
  updated: (number | null)[];
}

export interface DefectSlaConfig { enabled: boolean; stopAt: 'closed'; targetDays: Record<string, number | null> }

export type Dim = 'status' | 'severity' | 'team' | 'system' | 'module' | 'release' | 'owner' | 'creator' | 'openMonth' | 'closeMonth' | 'age';

export const DIM_LABELS: Record<Dim, string> = {
  status: 'סטטוס', severity: 'חומרה', team: 'צוות מטפל', system: 'מערכת', module: 'מודול',
  release: 'גרסה', creator: 'יוצר התקלה', owner: 'מטפל נוכחי', openMonth: 'חודש פתיחה',
  closeMonth: 'חודש סגירה', age: 'גיל תקלה',
};
export const DIM_ORDER: Dim[] = ['status', 'severity', 'team', 'system', 'module', 'release', 'creator', 'owner', 'openMonth', 'closeMonth', 'age'];
export const TIME_DIMS = new Set<Dim>(['openMonth', 'closeMonth']);

export const SEVERITY_ORDER = ['Show Stopper', 'Severe', 'Medium', 'Low'];
export const NONE_LABEL = 'ללא ערך';

export const AGE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0-7 ימים', min: 0, max: 7 },
  { label: '8-14 ימים', min: 8, max: 14 },
  { label: '15-30 ימים', min: 15, max: 30 },
  { label: '31-60 ימים', min: 31, max: 60 },
  { label: '60+ ימים', min: 61, max: Infinity },
];

const CLOSED = new Set(['closed', 'canceled', 'cancelled']);

export const todayNum = (): number => Math.floor(Date.now() / 86400000);
export const dayToDate = (n: number): Date => new Date(n * 86400000);
export const monthKey = (n: number): string => {
  const d = dayToDate(n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const fmtMonth = (key: string): string => { const [y, m] = key.split('-'); return `${m}/${y.slice(2)}`; };
export const fmtDay = (n: number): string => {
  const d = dayToDate(n);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

// Production defect = Environment (BG_USER_02) contains "prod", any case —
// the same rule as qc.service isProductionEnvironment (testing module). A
// defect with no Environment counts as a lower environment (user, 2026-10-06).
export function isProdEnv(d: DefectsAnalyticsDto, i: number): boolean {
  return /prod/i.test(d.dict.env?.[d.env?.[i] ?? -1] ?? '');
}

export function isOpen(d: DefectsAnalyticsDto, i: number): boolean {
  return !CLOSED.has((d.dict.status[d.status[i]] ?? '').toLowerCase());
}

// Open: age until today. Closed: detection → close (history close date).
export function ageOf(d: DefectsAnalyticsDto, i: number, today = todayNum()): number | null {
  const det = d.detected[i];
  if (det == null) return null;
  const end = isOpen(d, i) ? today : (d.closed[i] ?? today);
  return Math.max(0, end - det);
}

export function ageBucket(age: number | null): string | null {
  if (age == null) return null;
  return AGE_BUCKETS.find(b => age >= b.min && age <= b.max)?.label ?? null;
}

const dictLabel = (arr: string[], idx: number) => (idx >= 0 ? arr[idx] : NONE_LABEL) ?? NONE_LABEL;

// A defect can carry several teams (BG_USER_03 "A;B") — it counts under each.
export function valuesOf(d: DefectsAnalyticsDto, i: number, dim: Dim, today = todayNum()): string[] {
  switch (dim) {
    case 'status':   return [dictLabel(d.dict.status, d.status[i])];
    case 'severity': return [dictLabel(d.dict.severity, d.severity[i])];
    case 'team':     return d.teams[i].length ? d.teams[i].map(t => d.dict.team[t]) : [NONE_LABEL];
    case 'system':   return [dictLabel(d.dict.system, d.system[i])];
    case 'module':   return [dictLabel(d.dict.module, d.module[i])];
    case 'release':  return [dictLabel(d.dict.release, d.release[i])];
    case 'owner':    return [dictLabel(d.dict.person, d.owner[i])];
    case 'creator':  return [dictLabel(d.dict.person, d.creator[i])];
    case 'openMonth': return [d.detected[i] != null ? monthKey(d.detected[i]!) : NONE_LABEL];
    case 'closeMonth': return [d.closed[i] != null ? monthKey(d.closed[i]!) : 'לא נסגרה'];
    case 'age':      return [ageBucket(ageOf(d, i, today)) ?? NONE_LABEL];
  }
}

// ── Global filters ──────────────────────────────────────────────────────────
export interface Filters {
  years: number[]; quarters: number[]; months: number[];       // of the detection date
  release: string[]; system: string[]; module: string[]; team: string[]; status: string[]; severity: string[];
  envScope: ('low' | 'prod')[];      // [] = all environments (toggle, not a multi-select)
}
export const EMPTY_FILTERS: Filters = { years: [], quarters: [], months: [], release: [], system: [], module: [], team: [], status: [], severity: [], envScope: [] };
export const FILTER_DIMS: { key: keyof Filters; label: string; dim?: Dim }[] = [
  { key: 'years', label: 'שנה' }, { key: 'quarters', label: 'רבעון' }, { key: 'months', label: 'חודש' },
  { key: 'release', label: 'גרסה', dim: 'release' }, { key: 'system', label: 'מערכת', dim: 'system' },
  { key: 'module', label: 'מודול', dim: 'module' }, { key: 'team', label: 'צוות', dim: 'team' },
  { key: 'status', label: 'סטטוס', dim: 'status' }, { key: 'severity', label: 'חומרה', dim: 'severity' },
];
export const activeFilterCount = (f: Filters) => Object.values(f).reduce((s, v) => s + (v.length ? 1 : 0), 0);

export function applyFilters(d: DefectsAnalyticsDto, f: Filters): number[] {
  const sets = {
    release: new Set(f.release), system: new Set(f.system), module: new Set(f.module),
    team: new Set(f.team), status: new Set(f.status), severity: new Set(f.severity),
  };
  const out: number[] = [];
  for (let i = 0; i < d.id.length; i++) {
    if (f.envScope.length === 1 && (f.envScope[0] === 'prod') !== isProdEnv(d, i)) continue;
    if (f.years.length || f.quarters.length || f.months.length) {
      const det = d.detected[i];
      if (det == null) continue;
      const dt = dayToDate(det);
      if (f.years.length && !f.years.includes(dt.getUTCFullYear())) continue;
      if (f.quarters.length && !f.quarters.includes(Math.floor(dt.getUTCMonth() / 3) + 1)) continue;
      if (f.months.length && !f.months.includes(dt.getUTCMonth() + 1)) continue;
    }
    if (sets.release.size && !sets.release.has(dictLabel(d.dict.release, d.release[i]))) continue;
    if (sets.system.size && !sets.system.has(dictLabel(d.dict.system, d.system[i]))) continue;
    if (sets.module.size && !sets.module.has(dictLabel(d.dict.module, d.module[i]))) continue;
    if (sets.status.size && !sets.status.has(dictLabel(d.dict.status, d.status[i]))) continue;
    if (sets.severity.size && !sets.severity.has(dictLabel(d.dict.severity, d.severity[i]))) continue;
    if (sets.team.size && !valuesOf(d, i, 'team').some(t => sets.team.has(t))) continue;
    out.push(i);
  }
  return out;
}

// Choices for each filter, from the whole (unfiltered) dataset.
export function filterOptions(d: DefectsAnalyticsDto): Record<keyof Filters, { value: string | number; label: string }[]> {
  const years = new Set<number>();
  for (const det of d.detected) if (det != null) years.add(dayToDate(det).getUTCFullYear());
  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const list = (arr: string[]) => [...arr].sort((a, b) => a.localeCompare(b, 'he')).map(v => ({ value: v, label: v }));
  return {
    years: Array.from(years).sort((a, b) => b - a).map(y => ({ value: y, label: String(y) })),
    quarters: [1, 2, 3, 4].map(q => ({ value: q, label: `Q${q}` })),
    months: MONTHS.map((m, i) => ({ value: i + 1, label: m })),
    release: [...d.dict.release].sort((a, b) => b.localeCompare(a)).map(v => ({ value: v, label: v })),
    system: list(d.dict.system), module: list(d.dict.module), team: list(d.dict.team), status: list(d.dict.status),
    severity: SEVERITY_ORDER.filter(s => d.dict.severity.includes(s)).concat(d.dict.severity.filter(s => !SEVERITY_ORDER.includes(s))).map(v => ({ value: v, label: v })),
    envScope: [{ value: 'low', label: 'סביבות נמוכות' }, { value: 'prod', label: 'ייצור' }],
  };
}

// ── Grouping ────────────────────────────────────────────────────────────────
export interface Group { label: string; idx: number[] }

export function groupBy(d: DefectsAnalyticsDto, idx: number[], dim: Dim, today = todayNum()): Group[] {
  const m = new Map<string, number[]>();
  for (const i of idx) {
    for (const v of valuesOf(d, i, dim, today)) {
      let arr = m.get(v);
      if (!arr) { arr = []; m.set(v, arr); }
      arr.push(i);
    }
  }
  const groups = Array.from(m.entries()).map(([label, ids]) => ({ label, idx: ids }));
  return sortGroups(groups, dim);
}

// Natural order for ordinal dimensions, otherwise by size.
export function sortGroups(groups: Group[], dim: Dim): Group[] {
  if (TIME_DIMS.has(dim)) {
    return groups.sort((a, b) => {
      const ak = /^\d{4}-\d{2}$/.test(a.label) ? a.label : 'zzz';
      const bk = /^\d{4}-\d{2}$/.test(b.label) ? b.label : 'zzz';
      return ak.localeCompare(bk);
    });
  }
  if (dim === 'severity') {
    const rank = (l: string) => { const r = SEVERITY_ORDER.indexOf(l); return r < 0 ? 99 : r; };
    return groups.sort((a, b) => rank(a.label) - rank(b.label));
  }
  if (dim === 'age') {
    const rank = (l: string) => { const r = AGE_BUCKETS.findIndex(b => b.label === l); return r < 0 ? 99 : r; };
    return groups.sort((a, b) => rank(a.label) - rank(b.label));
  }
  return groups.sort((a, b) => b.idx.length - a.idx.length);
}

// Keep the first `n`, fold the rest into "אחר" (with its ids, so it still drills).
export function capGroups(groups: Group[], n: number): Group[] {
  if (groups.length <= n) return groups;
  const head = groups.slice(0, n);
  const rest = groups.slice(n);
  return [...head, { label: `אחר (${rest.length})`, idx: rest.flatMap(g => g.idx) }];
}

export const uniq = (idx: number[]) => Array.from(new Set(idx));
export const idsOf = (d: DefectsAnalyticsDto, idx: number[]) => uniq(idx).map(i => String(d.id[i]));

// ── Trend / backlog ─────────────────────────────────────────────────────────
export type Granularity = 'month' | 'week' | 'day';
export interface TrendBucket {
  key: string; label: string; start: number; end: number;      // [start, end) in day numbers
  opened: number[]; closed: number[]; openAtEnd: number;
}

export function trendBuckets(d: DefectsAnalyticsDto, idx: number[], g: Granularity, count: number, today = todayNum()): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  if (g === 'day') {
    for (let k = count - 1; k >= 0; k--) {
      const s = today - k;
      buckets.push({ key: String(s), label: fmtDay(s).slice(0, 5), start: s, end: s + 1, opened: [], closed: [], openAtEnd: 0 });
    }
  } else if (g === 'week') {
    // weeks start on Sunday (Israeli work week)
    const dow = dayToDate(today).getUTCDay();
    const thisWeek = today - dow;
    for (let k = count - 1; k >= 0; k--) {
      const s = thisWeek - k * 7;
      buckets.push({ key: String(s), label: fmtDay(s).slice(0, 5), start: s, end: s + 7, opened: [], closed: [], openAtEnd: 0 });
    }
  } else {
    const t = dayToDate(today);
    for (let k = count - 1; k >= 0; k--) {
      const y = t.getUTCFullYear(), m = t.getUTCMonth() - k;
      const s = Math.floor(Date.UTC(y, m, 1) / 86400000);
      const e = Math.floor(Date.UTC(y, m + 1, 1) / 86400000);
      const key = monthKey(s);
      buckets.push({ key, label: fmtMonth(key), start: s, end: e, opened: [], closed: [], openAtEnd: 0 });
    }
  }
  const first = buckets[0].start;
  const find = (day: number) => {
    if (day < first) return -1;
    for (let b = buckets.length - 1; b >= 0; b--) if (day >= buckets[b].start) return day < buckets[b].end ? b : -1;
    return -1;
  };
  for (const i of idx) {
    const det = d.detected[i], clo = d.closed[i];
    if (det != null) { const b = find(det); if (b >= 0) buckets[b].opened.push(i); }
    if (clo != null) { const b = find(clo); if (b >= 0) buckets[b].closed.push(i); }
  }
  for (const b of buckets) b.openAtEnd = countOpenAt(d, idx, b.end);
  return buckets;
}

// Open at the START of `day`: detected before it and not closed by then.
// (A defect's current close date is used — a closed-then-reopened one counts
// as open since detection; status history beyond the last close isn't loaded.)
export function countOpenAt(d: DefectsAnalyticsDto, idx: number[], day: number): number {
  let n = 0;
  for (const i of idx) {
    const det = d.detected[i];
    if (det == null || det >= day) continue;
    const clo = d.closed[i];
    if (clo == null || clo >= day) n++;
  }
  return n;
}
export function openAtIdx(d: DefectsAnalyticsDto, idx: number[], day: number): number[] {
  return idx.filter(i => {
    const det = d.detected[i];
    if (det == null || det >= day) return false;
    const clo = d.closed[i];
    return clo == null || clo >= day;
  });
}

// ── SLA ─────────────────────────────────────────────────────────────────────
export function slaStats(d: DefectsAnalyticsDto, idx: number[], cfg: DefectSlaConfig | null, today = todayNum()) {
  if (!cfg?.enabled) return null;
  let considered = 0;
  const breached: number[] = [];
  for (const i of idx) {
    const target = cfg.targetDays[d.dict.severity[d.severity[i]] ?? ''];
    if (!target) continue;
    const age = ageOf(d, i, today);
    if (age == null) continue;
    considered++;
    if (age > target) breached.push(i);
  }
  return { considered, breached, pct: considered ? Math.round(((considered - breached.length) / considered) * 100) : null };
}
