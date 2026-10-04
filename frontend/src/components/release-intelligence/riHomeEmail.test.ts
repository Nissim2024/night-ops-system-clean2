import { buildRiHomeEmailHtml, buildCrSections, CrSourceCycle, RiHomeEmailData } from './riHomeEmail';

// CR breakdown rules (user spec 2026-10-04)
const cyc = (cycleType: string, plannedStart: string, state: CrSourceCycle['state'], crNumbers: string[]): CrSourceCycle => ({
  cycleType, plannedStart, state, qgTargetPct: 90,
  crs: crNumbers.map(n => ({ crNumber: n, crLabel: `CR ${n}` })),
  crCoverage: crNumbers.map(n => ({ crNumber: n, crLabel: `CR ${n}`, passed: 8, failed: 2, total: 10, coveragePct: 100, tester: 'Limor', reportedDefectsCount: 3, stillOpenDefectsCount: 1 })),
});
const label = (t: string) => t;
const fmt = (d: string) => d;

describe('buildCrSections', () => {
  const timeline = [
    cyc('CYCLE_1', '2026-08-01', 'done', ['100', '200', '300']),
    cyc('STAND_ALONE', '2026-08-01', 'done', ['900']),
    cyc('CYCLE_2', '2026-08-20', 'active', ['100', '200']),
    cyc('CYCLE_3', '2026-09-10', 'upcoming', ['100', '400']),
    cyc('UAT', '2026-09-20', 'upcoming', ['100', '200']),
    cyc('GO_LIVE', '2026-09-30', 'upcoming', ['100']),
  ];
  const sections = buildCrSections(timeline, label, fmt);
  const nums = (kind: string, title?: string) => sections
    .filter(s => s.kind === kind && (!title || s.title.includes(title)))
    .flatMap(s => s.rows.map(r => r.crNumber));

  it('current cycle lists its CRs with test status', () => {
    expect(nums('current', 'CYCLE_2')).toEqual(['100', '200']);
    const row = sections[0].rows[0];
    expect([row.passed, row.failed, row.total, row.successPct, row.openDefects, row.reportedDefects]).toEqual([8, 2, 10, 80, 1, 3]);
  });
  it('a CR not in the current cycle shows once: future first, else past', () => {
    expect(nums('planned', 'עתידי')).toEqual(['400']);           // 100 is current, not repeated
    expect(nums('past').sort()).toEqual(['300', '900']);         // only in ended cycles
  });
  it('UAT lists all its CRs even when they appear in earlier cycles', () => {
    expect(nums('planned', 'UAT')).toEqual(['100', '200']);
  });
  it('rehearsal / go-live are not listed', () => {
    expect(sections.some(s => s.title.includes('GO_LIVE'))).toBe(false);
  });
  it('no active cycle -> the last cycle that started is "current"', () => {
    const s = buildCrSections([cyc('CYCLE_1', '2026-08-01', 'done', ['1']), cyc('CYCLE_2', '2026-08-20', 'upcoming', ['2'])], label, fmt);
    expect(s[0].kind).toBe('current');
    expect(s[0].title).toContain('CYCLE_1');
  });
  it('nothing started -> only planned', () => {
    const s = buildCrSections([cyc('CYCLE_1', '2026-08-01', 'upcoming', ['1'])], label, fmt);
    expect(s.map(x => x.kind)).toEqual(['planned']);
  });
});

// Desktop Outlook renders pasted HTML with Word's engine. These guard the
// rules the email template relies on (see riHomeEmail.ts header).
const sample: RiHomeEmailData = {
  title: 'סטטוס בדיקות גרסה ITv06-2026',
  stamp: '4 באוק׳ 2026, 22:35',
  href: 'https://deploycenter.example/?go=ri-home&versionId=v1',
  tiles: [
    { icon: '🩺', title: 'מדד מוכנות', value: '81', label: 'GO — מוכן', accent: 'ok', sub: '✓ Quality Gate: PASS', subTone: 'ok', lines: [{ text: '⛔ 1 סיכון קריטי לא ממותן', tone: 'bad' }] },
    { icon: '✅', title: 'כיסוי בדיקות', value: '42.00%', label: '', accent: 'brand', bar: { pct: 42, tone: 'warn' } },
    { icon: '🐞', title: 'תקלות', value: '3', label: 'תקלות פתוחות', accent: 'brand', lines: [{ text: '1 Severe · 2 Low' }] },
    { icon: '📈', title: 'תחזית', value: '12', label: 'ימים לעלייה לאוויר', accent: 'brand' },
    { icon: '⚠️', title: 'סיכוני איכות', value: '0', label: 'סיכונים פתוחים', accent: 'brand' },
  ],
  note: 'תקלות ייצור שנפתחו מאז עליית הגרסה: 3',
  cycles: [
    { name: 'סבב 1', dates: '09/08/2026 — 26/08/2026', state: 'done', crCount: 4, defectCount: 2, successPct: 95, targetPct: 90, progressPct: 100 },
    { name: 'UAT', dates: '24/08/2026 — 26/08/2026', state: 'active', crCount: 2, defectCount: 0, successPct: 0, targetPct: 100, progressPct: 30 },
    { name: 'סבב 2', dates: '27/08/2026 — 07/09/2026', state: 'upcoming', crCount: 0, defectCount: 0, successPct: null, targetPct: null, progressPct: 0 },
  ],
  alerts: [{ text: '1 תקלות חורגות מזמן הטיפול <script>', detail: 'מעל 10 ימים', tone: 'bad' }],
  crSections: [
    { kind: 'current', title: 'בסבב הנוכחי — סבב 2', rows: [{ crNumber: '13057', crLabel: 'חיוב', tester: 'Limor', passed: 8, failed: 2, total: 10, executedPct: 100, successPct: 80, targetPct: 90, openDefects: 1, reportedDefects: 3, cycleName: 'סבב 2', cycleStart: '20/08/2026' }] },
    { kind: 'planned', title: 'מתוכננים לסבב עתידי', rows: [{ crNumber: '13090', crLabel: '', tester: null, passed: 0, failed: 0, total: 0, executedPct: null, successPct: null, targetPct: 90, openDefects: 0, reportedDefects: 0, cycleName: 'סבב 3', cycleStart: '10/09/2026' }] },
  ],
};

describe('buildRiHomeEmailHtml', () => {
  const html = buildRiHomeEmailHtml(sample);

  it('uses no layout or styling Word ignores', () => {
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)/i);
    expect(html).not.toMatch(/border-radius|box-shadow|<style|class=/i);
    expect(html).not.toMatch(/\b(oklch|oklab|lab|lch|color-mix|rgba|hsl)\(/i);
    expect(html).not.toMatch(/var\(--/);
    // Word pads table cells only - spacing on a <div> must be margin
    expect(html).not.toMatch(/<div style="[^"]*padding/);
  });

  it('has no interactive leftovers — only the one "open in system" link', () => {
    expect(html).not.toMatch(/<button|<input|<select|onclick=/i);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('every colour is a plain hex', () => {
    const colours = html.match(/(?:color|background|bgcolor)[=:]\s*"?([^;"\s]+)/gi) ?? [];
    for (const c of colours) expect(c).toMatch(/#[0-9a-f]{6}\b/i);
  });

  it('renders all tiles, cycles and alerts as table cells', () => {
    expect(html.match(/border-top:4px solid/g)).toHaveLength(5);
    for (const c of sample.cycles) expect(html).toContain(c.name);
    expect(html).toContain('אחוז הצלחה');
    expect(html).toContain('תקלות ייצור שנפתחו מאז עליית הגרסה: 3');
  });

  it('progress bar is two bgcolor cells', () => {
    expect(html).toMatch(/<td width="42%" bgcolor="#d97706"/);
    expect(html).toMatch(/<td width="58%" bgcolor="#e5e7eb"/);
  });

  it('escapes text', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is right-to-left', () => {
    expect(html.startsWith('<table role="presentation" dir="rtl"')).toBe(true);
  });
});
