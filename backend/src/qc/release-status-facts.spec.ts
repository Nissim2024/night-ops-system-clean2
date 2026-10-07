import { deriveReleaseStatusFacts, ReleaseStatusEvent } from './qc.service';

// One AUDIT_LOG pass per release (2026-10-07) must give exactly what the three
// old queries gave: REOPENED_DEFECT_IDS_SQL, LATEST_REOPEN_TIME_SQL and
// BUG_DASHBOARD_CLOSE_DATES_SQL.
const ev = (defectId: string, newValue: string, at: string, o: Partial<ReleaseStatusEvent> = {}): ReleaseStatusEvent => ({
  defectId, newValue, at: new Date(at), reopenYn: 'Y', currentStatus: 'Open', testPhase: 'System Test', ...o,
});

describe('deriveReleaseStatusFacts', () => {
  it('reopened set keeps the KPI filters of the old query', () => {
    const f = deriveReleaseStatusFacts([
      ev('1', 'Reopen', '2026-09-01'),
      ev('2', 'Reopen', '2026-09-01', { reopenYn: null }),            // NVL(...,'Y') = 'Y'
      ev('3', 'Reopen', '2026-09-01', { reopenYn: 'N' }),
      ev('4', 'Reopen', '2026-09-01', { currentStatus: 'Canceled' }),
      ev('5', 'Reopen', '2026-09-01', { currentStatus: null }),       // NULL != 'Canceled' is not true in SQL
      ev('6', 'Reopen', '2026-09-01', { testPhase: 'UAT' }),
    ]);
    expect([...f.reopenedIds].sort()).toEqual(['1', '2']);
  });

  it('latest reopen = the newest Reopen, for every defect (no KPI filters)', () => {
    const f = deriveReleaseStatusFacts([
      ev('7', 'Reopen', '2026-09-01', { testPhase: 'UAT' }),
      ev('7', 'Reopen', '2026-09-05', { testPhase: 'UAT' }),
      ev('7', 'Closed', '2026-09-09'),
    ]);
    expect(f.latestReopen.get('7')?.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('close date = the newest Closed / Canceled / Cancelled (trimmed)', () => {
    const f = deriveReleaseStatusFacts([
      ev('8', 'Closed', '2026-09-02'),
      ev('8', 'Reopen', '2026-09-03'),
      ev('8', ' Canceled ', '2026-09-07'),
      ev('9', 'Fixed_Dev', '2026-09-04'),
    ]);
    expect(f.closeTimes.get('8')?.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(f.closeTimes.has('9')).toBe(false);
  });
});
