import { crNumberOf } from './qc.service';

// Real CR/HBR Number reference (BG_USER_10) shapes from the production export.
describe('crNumberOf', () => {
  it('reads the leading CR number ("13083 - name" / "13083")', () => {
    expect(crNumberOf('13083 - תהלכי שירות ללקוח סיבים')).toBe('13083');
    expect(crNumberOf('10421')).toBe('10421');
  });
  it('reads a trailing CR number ("name - 12461")', () => {
    expect(crNumberOf('שדרוג חלונות בילי - 12461')).toBe('12461');
    expect(crNumberOf('קופונים - 12529 ')).toBe('12529');
  });
  it('is not fooled by release names or categories', () => {
    expect(crNumberOf('ITv08-2024')).toBeNull();
    expect(crNumberOf('V03-2023')).toBeNull();
    expect(crNumberOf('Production')).toBeNull();
    expect(crNumberOf('')).toBeNull();
    expect(crNumberOf(null)).toBeNull();
  });
});
