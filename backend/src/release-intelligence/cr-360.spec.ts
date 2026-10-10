import { testsFinished, planStateOf, planOverall, crTrafficLight } from './cr-360';

// CR card rules (user decisions 2026-10-10)
describe('CR card', () => {
  const cov = (notRun: number, notCompleted: number, total = 10) => ({ total, notRun, notCompleted });

  it('tests are finished only when nothing is Not Run or Not Completed', () => {
    expect(testsFinished([cov(0, 0), cov(0, 0)])).toBe(true);
    expect(testsFinished([cov(0, 0), cov(1, 0)])).toBe(false);
    expect(testsFinished([cov(0, 2)])).toBe(false);
    expect(testsFinished([])).toBe(false);            // no tests = not finished
    expect(testsFinished([cov(0, 0, 0)])).toBe(false);
  });

  it('plan state per team and overall', () => {
    const p = (o: any) => ({ notNeededForPlan: false, planApproved: false, submissionStatus: 'DRAFT', gateAnswered: false, ...o });
    expect(planStateOf(undefined)).toBe('not-started');
    expect(planStateOf(p({}))).toBe('not-started');
    expect(planStateOf(p({ gateAnswered: true }))).toBe('draft');
    expect(planStateOf(p({ submissionStatus: 'SUBMITTED' }))).toBe('submitted');
    expect(planStateOf(p({ submissionStatus: 'RETURNED' }))).toBe('returned');
    expect(planStateOf(p({ planApproved: true }))).toBe('approved');
    expect(planStateOf(p({ notNeededForPlan: true }))).toBe('not-needed');
    expect(planOverall([{ state: 'approved' }, { state: 'not-needed' }])).toBe('complete');
    expect(planOverall([{ state: 'approved' }, { state: 'draft' }])).toBe('partial');
    expect(planOverall([{ state: 'not-started' }, { state: 'not-started' }])).toBe('not-opened');
    expect(planOverall([])).toBe('none');
  });

  it('traffic light: red on an open Show Stopper, amber on a gap, green when all is well', () => {
    const ok = { openShowStopper: 0, openSevere: 0, dailyRisk: 'LOW', testsFinished: true, hasTests: true, failedTests: 0,
      plan: 'complete' as const, openBlockers: 0, highManualRisks: 0, uatPlanned: true, uatDone: true, daysToGoLive: 10 };
    expect(crTrafficLight(ok).light).toBe('green');
    expect(crTrafficLight({ ...ok, openShowStopper: 1 }).light).toBe('red');
    expect(crTrafficLight({ ...ok, plan: 'partial' }).light).toBe('amber');
    // close to go-live an unfinished plan / tests turn red
    expect(crTrafficLight({ ...ok, plan: 'partial', daysToGoLive: 2 }).light).toBe('red');
    expect(crTrafficLight({ ...ok, testsFinished: false, daysToGoLive: 1 }).light).toBe('red');
    const r = crTrafficLight({ ...ok, openSevere: 2, uatDone: false });
    expect(r.light).toBe('amber');
    expect(r.reasons.map(x => x.text)).toEqual(['2 תקלות Severe פתוחות', 'בדיקות המשתמשים (UAT) טרם הושלמו']);
  });
});
