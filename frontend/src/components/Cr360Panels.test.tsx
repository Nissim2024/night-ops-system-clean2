import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Cr360Panels, Cr360 } from './Cr360Panels';

// the shared UI kit pulls Radix, which this Jest setup can't load — plain stand-ins
jest.mock('./ui', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
}));
jest.mock('./ui/BrandedDialog', () => ({
  BrandedDialog: ({ children }: any) => <div>{children}</div>,
  DialogButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

// CR card panels (2026-10-10): numbers drill into exactly the defects behind them
const d = (id: string, severity: string, open: boolean, defectType = 'Functional', cycle = 'Cycle 1', isProd = false) =>
  ({ id, title: `defect ${id}`, severity, status: open ? 'Open' : 'Closed', open, defectType, cycle, detectedOn: '2026-09-01', isProd });

const base: Cr360 = {
  crNumber: '13085', crLabel: 'Fiber', versionId: 'v1',
  versions: [{ id: 'v1', name: 'ITv06-2026', goLive: '2026-12-01', archived: false }],
  version: { id: 'v1', name: 'ITv06-2026', goLive: '2026-12-01', daysToGoLive: 30 },
  light: { light: 'red', reasons: [{ key: 'ss', light: 'red', text: '1 תקלות Show Stopper פתוחות' }] },
  defects: {
    testing: [d('1', 'Show Stopper', true), d('2', 'Severe', false, 'Data'), d('3', 'Severe', true, 'Data', 'UAT'), d('4', 'Low', false)],
    afterGoLive: [d('9', 'Medium', true, 'Functional', 'Go Live', true)],
    blocking: [d('1', 'Show Stopper', true), d('3', 'Severe', true, 'Data', 'UAT')],
  },
  coverage: { cycles: [{ cycleName: 'Cycle 1', passed: 8, failed: 1, blocked: 0, notRun: 1, notCompleted: 0, notReady: 0, total: 10, executedPct: 90, responsible: 'roi' }], finished: false },
  risks: { daily: { risk: 'HIGH', reasons: ['תקלה קריטית פתוחה'], progressPct: 40, tester: 'roi' }, plans: [], blockers: [], manual: [] },
  uat: { planned: true, done: false, coverage: [], testers: ['Dana'], defects: [d('3', 'Severe', true, 'Data', 'UAT')], window: null },
  testSummary: { finished: false, text: null },
  plan: { status: 'partial', teams: [
    { team: 'CRM', state: 'approved', submittedBy: null, approvedBy: 'Ofir', returnReason: null, riskLevel: null, plan: null },
    { team: 'Web', state: 'not-started', submittedBy: null, approvedBy: null, returnReason: null, riskLevel: null, plan: null },
  ] },
  dependencies: { dependsOn: [{ crNumber: '13001', note: null, team: 'CRM', crLabel: 'Other CR', inVersion: true, executedPct: 50, testsFinished: false, openDefectIds: ['77', '78'] }], dependedBy: [] },
  timeline: [],
};

describe('Cr360Panels', () => {
  it('drills into the defects behind each number', () => {
    const onDrill = jest.fn();
    render(<Cr360Panels data={base} onDrill={onDrill} onOpenCr={() => {}} />);
    // the "סה"כ" row: all 4 defects / 2 open
    const total = screen.getByText('סה"כ').closest('tr')!;
    fireEvent.click(within(total).getByText('4'));
    expect(onDrill).toHaveBeenLastCalledWith('CR 13085 — כל התקלות', ['1', '2', '3', '4']);
    fireEvent.click(within(total).getByText('2'));
    expect(onDrill).toHaveBeenLastCalledWith('CR 13085 — תקלות פתוחות', ['1', '3']);
    // a traffic-light reason opens its defects
    fireEvent.click(screen.getByText('1 תקלות Show Stopper פתוחות'));
    expect(onDrill).toHaveBeenLastCalledWith('CR 13085 — Show Stopper פתוחות', ['1']);
    // the dependency's open defects
    fireEvent.click(screen.getByTitle('פתח את כרטיס ה-CR').closest('div')!.querySelector('button[title="הצג את התקלות"]')!);
    expect(onDrill).toHaveBeenLastCalledWith('CR 13001 — תקלות פתוחות', ['77', '78']);
  });

  it('shows the plan gaps and the test-summary rule', () => {
    render(<Cr360Panels data={base} onDrill={() => {}} onOpenCr={() => {}} />);
    expect(screen.getByText('טרם השלימו: Web')).toBeTruthy();
    expect(screen.getByText('⏳ סיכום יוצג בסיום הבדיקות.')).toBeTruthy();
  });

  it('finished tests without a summary say so', () => {
    render(<Cr360Panels data={{ ...base, testSummary: { finished: true, text: null } }} onDrill={() => {}} onOpenCr={() => {}} />);
    expect(screen.getByText('⚠ הבדיקות הסתיימו — לא נכתב סיכום בדיקות.')).toBeTruthy();
  });
});
