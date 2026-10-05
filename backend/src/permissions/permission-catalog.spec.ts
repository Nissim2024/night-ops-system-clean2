import { expandGrants, normalizeGrants, PERMISSION_CATALOG } from './permission-catalog';

describe('permission catalog', () => {
  it('a module grant brings every component of that module', () => {
    const ri = PERMISSION_CATALOG.find(m => m.id === 'release-intelligence')!;
    const out = expandGrants(['module:release-intelligence']);
    for (const i of ri.items) expect(out).toContain(i.key);
    expect(out).toContain('partial:module:release-intelligence');
  });

  it('a component grant marks its module partial, not whole', () => {
    const out = expandGrants(['ri:risks']);
    expect(out).toContain('ri:risks');
    expect(out).toContain('partial:module:release-intelligence');
    expect(out).not.toContain('module:release-intelligence');
    expect(out).not.toContain('ri:daily-qa');
  });

  it('legacy module keys open the screens only, never the actions', () => {
    expect(normalizeGrants(['screen:defects'])).toEqual(['defects:view']);
    const qa = normalizeGrants(['screen:qa']);
    expect(qa).toContain('qa:assignment');
    expect(qa).not.toContain('action:qa_manage');
  });

  it('an action alone does not open its module', () => {
    const out = expandGrants(['action:qa_leave_request']);
    expect(out).toContain('action:qa_leave_request');
    expect(out).not.toContain('partial:module:qa');
  });

  it('the removed "ביצוע" screen is dropped from stored grants', () => {
    expect(normalizeGrants(['screen:handoff', 'screen:prep'])).toEqual(['screen:prep']);
  });

  it('unknown keys are dropped', () => {
    expect(normalizeGrants(['nope', 'action:gonogo'])).toEqual(['action:gonogo']);
  });

  it('every catalog key is unique', () => {
    const keys = PERMISSION_CATALOG.flatMap(m => [m.key, ...m.items.map(i => i.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
