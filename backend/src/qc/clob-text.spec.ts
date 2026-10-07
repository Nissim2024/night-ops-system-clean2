import { cleanClobComments, cleanClobDescription } from './qc.service';

describe('full CLOB text cleanup (defect form, 2026-10-07)', () => {
  it('keeps a long Hebrew comment thread whole (was cut at 4000 bytes ≈ 2000 Hebrew chars)', () => {
    const line = '<div>נבדק שוב בסביבת הבדיקות — התקלה עדיין משתחזרת אצל לקוח</div>';
    const raw = Array.from({ length: 120 }, (_, i) => `${line}<br>${i}`).join('');
    const out = cleanClobComments(raw);
    expect(Buffer.byteLength(out, 'utf8')).toBeGreaterThan(8000);
    expect(out.endsWith('119')).toBe(true);
    expect(out).not.toMatch(/<[^>]*>/);
  });

  it('decodes entities and collapses spaces the same way the SQL did', () => {
    expect(cleanClobComments('  <b>a</b> &gt; b &lt; c&nbsp;&nbsp;d &amp; &quot;e&quot;   f  ')).toBe('a > b < c d & e f');
  });

  it('description: tags removed only', () => {
    expect(cleanClobDescription('<p>שלום &amp; world</p>')).toBe('שלום &amp; world');
  });
});
