import { testPhaseFor, withRequiredFields, CREATE_REQUIRED_FIELDS } from './openProdDefectsFields';

// Test Phase follows the cycle (user, 2026-10-09)
describe('testPhaseFor', () => {
  it.each([
    ['Cycle 0', '2 - Test', 'Integration Test'],
    ['Cycle 1', '2 - Test', 'System Test'],
    ['Cycle 2', '', 'System Test'],
    ['Cycle 3', '', 'System Test'],
    ['Cycle 4', '', 'System Test'],
    ['UAT', '', 'System Test'],
    ['Stand Alone Items', '', 'System Test'],
    ['Dress Rehearsal', '', 'Sanity Test'],
    ['Dress Reherssal', '', 'Sanity Test'],
    ['Dress Rehessal', '', 'Sanity Test'],
    ['Go Live', '2 - Test', 'Sanity Test'],
    ['Production', '', 'Production'],
  ])('%s (%s) → %s', (cycle, env, expected) => {
    expect(testPhaseFor(cycle, env)).toBe(expected);
  });
  it('a production Environment wins over the cycle', () => {
    expect(testPhaseFor('Go Live', '4 - Production')).toBe('Production');
    expect(testPhaseFor('', 'Crm Prod')).toBe('Production');
  });
  it('no rule → left to the user', () => {
    expect(testPhaseFor('Automation', '2 - Test')).toBeNull();
    expect(testPhaseFor('SHOTEF', '')).toBeNull();
    expect(testPhaseFor('', '2 - Test')).toBeNull();
  });
});

// a saved layout without Project still shows it — in the detection panel (2026-10-09)
describe('withRequiredFields', () => {
  const layout = () => [
    { name: 'Identification', fields: ['id', 'status', 'severity', 'priority', 'environment', 'crHbrNumberReference', 'responsibility'] },
    { name: 'Detection', fields: ['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'testPhase', 'environmentComponent', 'subModule'] },
    { name: 'Target', fields: ['targetRelease', 'targetCycle', 'dropNumber'] },
  ];
  it('adds a missing required field next to its built-in neighbour', () => {
    const out = withRequiredFields(layout());
    expect(out[1].fields).toEqual(['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'testPhase', 'environmentComponent', 'system', 'subModule']);
    expect(out.flatMap(p => p.fields).filter(f => f === 'system')).toHaveLength(1);
  });
  it('every required field ends up in the form, nothing is duplicated', () => {
    const out = withRequiredFields([{ name: 'A', fields: [] }]);
    for (const f of Array.from(CREATE_REQUIRED_FIELDS)) expect(out[0].fields).toContain(f);
    expect(new Set(out[0].fields).size).toBe(out[0].fields.length);
  });
  it('leaves the input untouched', () => {
    const l = layout();
    withRequiredFields(l);
    expect(l[1].fields).not.toContain('system');
  });
});
