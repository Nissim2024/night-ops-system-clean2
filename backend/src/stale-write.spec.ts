import { assertNotStale, assertFieldsUnchanged } from './stale-write';

jest.mock('./prisma-client', () => ({ prisma: {} }));

// "Someone saved this meanwhile" (2026-10-10)
describe('stale-write', () => {
  const t0 = new Date('2026-10-10T10:00:00.000Z');
  const later = new Date('2026-10-10T10:05:00.000Z');

  it('refuses a whole-record save based on an older version, naming the editor', () => {
    expect(() => assertNotStale({ updatedAt: later, updatedByName: 'Dana' }, { baseUpdatedAt: t0.toISOString() }, 'הסיכון עודכן'))
      .toThrow(/הסיכון עודכן בינתיים על ידי Dana/);
  });
  it('lets through: same version, no base (old screen / sync), or force', () => {
    expect(() => assertNotStale({ updatedAt: t0 }, { baseUpdatedAt: t0.toISOString() }, 'x')).not.toThrow();
    expect(() => assertNotStale({ updatedAt: later }, {}, 'x')).not.toThrow();
    expect(() => assertNotStale({ updatedAt: later }, { baseUpdatedAt: t0.toISOString(), force: true }, 'x')).not.toThrow();
  });
  it('field-level: only a field changed by someone else blocks', () => {
    const cur = { qaEffort: 7.5, sortOrder: 2, cycles: ['CYCLE_1', 'UAT'], standAloneDueDate: later, updatedByName: 'Dana' };
    expect(() => assertFieldsUnchanged(cur, { qaEffort: 26 }, false, 'שיבוץ', { qaEffort: 'ימי עבודה' })).toThrow(/ימי עבודה שונה בינתיים על ידי Dana/);
    expect(() => assertFieldsUnchanged(cur, { sortOrder: 2 }, false, 'שיבוץ')).not.toThrow();
    // order of a list and date formats don't count as a change
    expect(() => assertFieldsUnchanged(cur, { cycles: ['UAT', 'CYCLE_1'], standAloneDueDate: later.toISOString() }, false, 'x')).not.toThrow();
    // empty / null / undefined are the same "no value"
    expect(() => assertFieldsUnchanged({ notes: null }, { notes: '' }, false, 'x')).not.toThrow();
    expect(() => assertFieldsUnchanged(cur, { qaEffort: 26 }, true, 'x')).not.toThrow();
  });
});
