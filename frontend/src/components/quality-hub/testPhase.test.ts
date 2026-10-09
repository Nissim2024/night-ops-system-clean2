import { testPhaseFor, withRequiredFields, CREATE_REQUIRED_FIELDS, normalizeLayout, pairUp, keepPairsTogether } from './openProdDefectsFields';

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
    const l = layout();
    l[0].fields = l[0].fields.filter(f => f !== 'crHbrNumberReference');   // CR/HBR is added right after its partner Project
    const out = withRequiredFields(l);
    expect(out[1].fields).toEqual(['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'testPhase', 'environmentComponent', 'system', 'crHbrNumberReference', 'subModule']);
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

// three panels on top + one full-width "שדות נוספים" (2026-10-09)
describe('normalizeLayout', () => {
  it('an older layout keeps 3 panels on top and merges the rest below', () => {
    const out = normalizeLayout([
      { name: 'Identification', fields: ['id'] }, { name: 'Detection', fields: ['detectedBy'] },
      { name: 'Responsibility', fields: ['assignedTo'] }, { name: 'Target', fields: ['targetRelease', 'targetCycle', 'dropNumber'], wide: ['dropNumber'] },
      { name: 'Impact', fields: ['impact'] },
    ]);
    expect(out.map(p => p.name)).toEqual(['Identification', 'Detection', 'Responsibility', 'שדות נוספים']);
    expect(out[3]).toMatchObject({ below: true, fields: ['targetRelease', 'targetCycle', 'dropNumber', 'impact'], wide: ['dropNumber'] });
  });
  it('a layout that already marks a panel below is kept as is', () => {
    const l = [{ name: 'A', fields: ['id'] }, { name: 'B', fields: ['x'] }, { name: 'C', fields: [] }, { name: 'D', fields: [] }, { name: 'More', fields: ['y'], below: true }];
    expect(normalizeLayout(l).map(p => p.name)).toEqual(['A', 'B', 'C', 'D', 'More']);
  });
  it('three panels or fewer → nothing below', () => {
    expect(normalizeLayout([{ name: 'A', fields: ['id'] }]).some(p => p.below)).toBe(false);
  });
});

// related fields side by side (2026-10-09)
describe('field pairs', () => {
  it('pairUp groups a pair only when both are there, first member first', () => {
    expect(pairUp(['detectedInCycle', 'severity', 'detectedInRelease', 'environment']))
      .toEqual([['detectedInRelease', 'detectedInCycle'], 'severity', 'environment']);
  });
  it('keepPairsTogether brings the partner next to the first field, across panels, and drops ↔', () => {
    const l = [
      { name: 'A', fields: ['environment', 'severity'], wide: ['environment'] },
      { name: 'B', fields: ['priority', 'environmentComponent'] },
    ];
    keepPairsTogether(l);
    expect(l[0].fields).toEqual(['environment', 'environmentComponent', 'severity']);
    expect(l[1].fields).toEqual(['priority']);
    expect(l[0].wide).toEqual([]);
  });
  it('the field just moved is followed by its partner', () => {
    const l = [{ name: 'A', fields: ['environment', 'x'] }, { name: 'B', fields: ['y', 'environmentComponent'] }];
    keepPairsTogether(l, 'environmentComponent');
    expect(l[0].fields).toEqual(['x']);
    expect(l[1].fields).toEqual(['y', 'environment', 'environmentComponent']);
  });
  it('a required field joins its partner (Project right before CR/HBR)', () => {
    const out = withRequiredFields([{ name: 'A', fields: ['severity', 'crHbrNumberReference', 'priority'] }, { name: 'B', fields: ['detectedBy'] }]);
    const a = out[0].fields;
    expect(a[a.indexOf('crHbrNumberReference') - 1]).toBe('system');
  });
  it('CR/HBR + Project are never rendered side by side, but kept together with Project first', () => {
    expect(pairUp(['crHbrNumberReference', 'system'])).toEqual(['crHbrNumberReference', 'system']);
    const l = [{ name: 'A', fields: ['crHbrNumberReference', 'x'], wide: ['crHbrNumberReference'] }, { name: 'B', fields: ['system'] }];
    keepPairsTogether(l);
    expect(l[1].fields).toEqual(['system', 'crHbrNumberReference']);
    expect(l[0].wide).toEqual(['crHbrNumberReference']);
  });
  it('an older layout comes out with its pairs together', () => {
    const out = normalizeLayout([{ name: 'A', fields: ['detectedInRelease', 'severity', 'detectedInCycle'] }]);
    expect(out[0].fields).toEqual(['detectedInRelease', 'detectedInCycle', 'severity']);
  });
});
