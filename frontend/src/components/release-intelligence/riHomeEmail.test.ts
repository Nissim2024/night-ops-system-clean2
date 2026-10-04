import { buildRiHomeEmailHtml, RiHomeEmailData } from './riHomeEmail';

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
