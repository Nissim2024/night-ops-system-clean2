import { analyticsSqlWith, cleanDefectDims, encodeDefectsAnalytics, DEFECT_DIM_BUILTIN_KEYS } from './qc.service';

// Defects dashboard "הצג לפי" list (user, 2026-10-10)
describe('defects dashboard dims', () => {
  it('adds the chosen fields as X_<i> columns, from the field registry only', () => {
    const sql = analyticsSqlWith(['crHbrNumberReference', 'testPhase']);
    expect(sql).toContain('BUG.BG_USER_10 AS X_0');
    expect(sql).toContain('BUG.BG_USER_05 AS X_1');
    expect(sql.indexOf('AS X_1')).toBeLessThan(sql.indexOf('FROM BUG'));
    expect(analyticsSqlWith(['nope; DROP TABLE BUG'])).toContain('NULL AS X_0');
  });

  it('keeps built-ins (hidden when left out), drops unknown fields and duplicates', () => {
    const dims = cleanDefectDims([
      { key: 'system', label: '  System  ' },
      { key: 'f:crHbrNumberReference', label: 'לפי CR' },
      { key: 'f:notAField', label: 'x' },
      { key: 'system', label: 'dup' },
      { key: 'f:description', label: 'memo field' },
    ]);
    expect(dims[0]).toEqual({ key: 'system', label: 'System' });
    expect(dims[1]).toEqual({ key: 'f:crHbrNumberReference', label: 'לפי CR' });
    expect(dims.filter(d => d.key === 'system')).toHaveLength(1);
    expect(dims.some(d => d.key === 'f:notAField' || d.key === 'f:description')).toBe(false);
    for (const k of DEFECT_DIM_BUILTIN_KEYS) expect(dims.some(d => d.key === k)).toBe(true);
    expect(dims.find(d => d.key === 'status')?.hidden).toBe(true);
  });

  it('groups a CR by its number, people by full name', () => {
    const base = { DEFECT_STATUS: 'Open', SEVERITY: 'Low', RESPONSIBILITY: null, SYSTEM_NAME: null, SUB_MODULE: null, ENVIRONMENT: null,
      ASSIGNED_TO: null, DETECTED_BY: null, DETECTED_IN_RELEASE: null, DETECTED_ON_DATE: null, MODIFIED: null };
    const rows: any[] = [
      { ...base, DEFECT_ID: 1, X_0: '13083 - Fiber on Bezeq', X_1: 'dlevi' },
      { ...base, DEFECT_ID: 2, X_0: '13083 -  Fiber on Bezeq (old name)', X_1: 'dlevi' },
      { ...base, DEFECT_ID: 3, X_0: 'Production', X_1: null },
      { ...base, DEFECT_ID: 4, X_0: null, X_1: 'other' },
    ];
    const d = encodeDefectsAnalytics(rows, l => (l === 'dlevi' ? 'Dana Levi' : l), false, ['crHbrNumberReference', 'qaTester']);
    expect(d.extra.crHbrNumberReference).toEqual([0, 0, 1, -1]);
    expect(d.extraDict.crHbrNumberReference).toEqual(['13083 - Fiber on Bezeq', 'Production']);
    expect(d.extraDict.qaTester).toEqual(['Dana Levi', 'other']);
  });
});
