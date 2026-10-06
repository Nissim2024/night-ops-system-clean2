import { deriveVersionStage, StageSignals } from './version-lifecycle';

const d = (s: string) => new Date(s);
const base: StageSignals = {
  status: 'APPROVED',
  integrationStart: d('2026-07-30T00:00:00'), integrationEnd: d('2026-08-08T23:59:00'),
  rehearsalStart: null, rehearsalEnd: null,
  goLive: d('2026-09-14T19:00:00'),
  cycles: [
    { cycleType: 'CYCLE_1', plannedStart: d('2026-08-09T00:00:00'), plannedEnd: d('2026-08-20T23:59:00') },
    { cycleType: 'STAND_ALONE', plannedStart: d('2026-08-09T00:00:00'), plannedEnd: d('2026-08-30T23:59:00') },
    { cycleType: 'CYCLE_2', plannedStart: d('2026-08-24T00:00:00'), plannedEnd: d('2026-09-01T23:59:00') },
    { cycleType: 'REHEARSAL', plannedStart: d('2026-09-06T00:00:00'), plannedEnd: d('2026-09-06T23:59:00') },
    { cycleType: 'CYCLE_3', plannedStart: d('2026-09-07T00:00:00'), plannedEnd: d('2026-09-10T23:59:00') },
  ],
};
const at = (iso: string, s: Partial<StageSignals> = {}) => deriveVersionStage({ ...base, ...s }, d(iso)).label;

describe('deriveVersionStage', () => {
  it('before integration → בהיערכות', () => expect(at('2026-07-20T10:00:00')).toBe('בהיערכות'));
  it('integration window', () => expect(at('2026-08-01T10:00:00')).toBe('בבדיקות אינטגרציה'));
  it('core cycle running, parallel cycle listed', () => {
    const s = deriveVersionStage(base, d('2026-08-10T10:00:00'));
    expect(s.label).toBe('בבדיקות סבב 1');
    expect(s.parallel).toEqual(['Stand Alone']);
  });
  it('gap between cycles → היערכות לסבב הבא', () => expect(at('2026-08-22T10:00:00')).toBe('היערכות לסבב 2'));
  it('gap before rehearsal', () => expect(at('2026-09-03T10:00:00')).toBe('היערכות לחזרה גנרלית'));
  it('rehearsal day', () => expect(at('2026-09-06T10:00:00')).toBe('בחזרה גנרלית'));
  it('cycle 3 after rehearsal', () => expect(at('2026-09-08T10:00:00')).toBe('בבדיקות סבב 3'));
  it('gap before go-live', () => expect(at('2026-09-12T10:00:00')).toBe('היערכות לעלייה לאוויר'));
  it('go-live day', () => expect(at('2026-09-14T08:00:00')).toBe('בעלייה לאוויר'));
  it('after go-live day, night not closed → עבר מועד העלייה', () => expect(at('2026-09-16T08:00:00')).toBe('עבר מועד העלייה'));
  it('completed → בייצור', () => expect(at('2026-09-16T08:00:00', { status: 'COMPLETED' })).toBe('בייצור'));
  it('night status wins over dates', () => expect(at('2026-08-10T10:00:00', { status: 'ACTIVE' })).toBe('בעלייה לאוויר'));
  it('rolled back', () => expect(at('2026-08-10T10:00:00', { status: 'ROLLED_BACK' })).toBe('בוטלה'));
  it('no dates at all → בהיערכות', () =>
    expect(at('2026-08-10T10:00:00', { integrationStart: null, integrationEnd: null, goLive: null, cycles: [] })).toBe('בהיערכות'));
});
