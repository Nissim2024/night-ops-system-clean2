import { parseNoteEntries } from './noteEntries';

// Comments field parsing (user report 2026-10-06: a header showed up on the
// right, inside the previous comment, and comments weren't in date order).
describe('parseNoteEntries', () => {
  it('splits on underscore separators and sorts oldest → newest', () => {
    const raw = '________\nDana Cohen <danac>, 12/5/2026: שני\n________\nLimor Kalchuk <limork>, 10/5/2026: ראשון';
    const e = parseNoteEntries(raw);
    expect(e.map(x => x.body)).toEqual(['ראשון', 'שני']);
    expect(e[0].header).toBe('Limor Kalchuk <limork>, 10/5/2026:');
  });

  it('splits a header that appears mid-text without a separator', () => {
    const raw = 'Limor Kalchuk <limork>, 10/5/2026: בוצעה בדיקה Dana Cohen <danac>, 11/5/2026: תוקן';
    const e = parseNoteEntries(raw);
    expect(e).toHaveLength(2);
    expect(e[0].body).toBe('בוצעה בדיקה');
    expect(e[1].header).toBe('Dana Cohen <danac>, 11/5/2026:');
    expect(e[1].body).toBe('תוקן');
  });

  it('keeps same-day entries in their original order and legacy text first', () => {
    const raw = 'טקסט ישן\n________\nB B <b>, 1/2/2026: second\n________\nA A <a>, 1/2/2026: third';
    const e = parseNoteEntries(raw);
    expect(e.map(x => x.body)).toEqual(['טקסט ישן', 'second', 'third']);
    expect(e[0].header).toBeNull();
  });

  it('reads D/M/YYYY (10/5 is May 10, before 2/6)', () => {
    const raw = 'X Y <x>, 2/6/2026: june\n________\nX Y <x>, 10/5/2026: may';
    expect(parseNoteEntries(raw).map(x => x.body)).toEqual(['may', 'june']);
  });
});
