import { testPhaseFor } from './openProdDefectsFields';

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
