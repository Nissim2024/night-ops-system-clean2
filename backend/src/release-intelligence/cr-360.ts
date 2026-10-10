// The full picture of one CR in one version (user, 2026-10-10 — CR search
// card for a project manager / anyone who asks "what's the status of CR X"):
// defects, coverage per cycle, risks (automatic + manual), user tests (UAT),
// test summary, deployment plan, dependencies, timeline, defects after
// go-live, and an overall traffic light with its reasons. Every list is sent
// with the ids behind it so the card can drill into exactly those defects.
// Pure assembly — the data comes from the services that already own it.

export type Light = 'green' | 'amber' | 'red';

export interface Cr360Defect {
  id: string; title: string; severity: string; status: string; open: boolean;
  defectType: string; cycle: string; detectedOn: string; isProd: boolean;
}

export interface Cr360PlanTeam {
  team: string;
  state: 'approved' | 'not-needed' | 'submitted' | 'returned' | 'draft' | 'not-started';
  submittedBy: string | null; approvedBy: string | null; returnReason: string | null;
  riskLevel: string | null;
  plan: null | {
    workPlan: string | null; scripts: string | null; runTimes: string | null; rollbackPlan: string | null;
    gradualRollout: boolean; gradualDetails: string | null; nightTestingNotes: string | null; morningMonitoring: string | null;
    actions: { description: string; phase: number; system: string | null; ownerName: string | null }[];
    monitoring: { type: string; name: string; note: string | null }[];
  };
}

export const CLOSED_STATUSES = new Set(['closed', 'canceled', 'cancelled']);
export const isOpenStatus = (s: string) => !CLOSED_STATUSES.has((s ?? '').trim().toLowerCase());

// "the CR's tests are finished" (user, 2026-10-10): it has tests, and none is
// Not Run or Not Completed
export function testsFinished(cov: { total: number; notRun: number; notCompleted: number }[]): boolean {
  const total = cov.reduce((s, c) => s + c.total, 0);
  return total > 0 && cov.every(c => c.notRun === 0 && c.notCompleted === 0);
}

export function planStateOf(p: {
  notNeededForPlan: boolean; planApproved: boolean; submissionStatus: string; gateAnswered: boolean;
} | undefined): Cr360PlanTeam['state'] {
  if (!p) return 'not-started';
  if (p.notNeededForPlan) return 'not-needed';
  if (p.planApproved || p.submissionStatus === 'APPROVED') return 'approved';
  if (p.submissionStatus === 'SUBMITTED') return 'submitted';
  if (p.submissionStatus === 'RETURNED') return 'returned';
  return p.gateAnswered ? 'draft' : 'not-started';
}

// complete = every team approved or "not needed"; not-opened = nobody started
export function planOverall(teams: { state: Cr360PlanTeam['state'] }[]): 'none' | 'complete' | 'partial' | 'not-opened' {
  if (teams.length === 0) return 'none';
  if (teams.every(t => t.state === 'approved' || t.state === 'not-needed')) return 'complete';
  if (teams.every(t => t.state === 'not-started')) return 'not-opened';
  return 'partial';
}

// Overall status of the CR, with every reason that decided it
export function crTrafficLight(s: {
  openShowStopper: number; openSevere: number; dailyRisk: string | null;
  testsFinished: boolean; hasTests: boolean; failedTests: number;
  plan: ReturnType<typeof planOverall>; openBlockers: number; highManualRisks: number;
  uatPlanned: boolean; uatDone: boolean; daysToGoLive: number | null;
}): { light: Light; reasons: { key: string; light: Light; text: string }[] } {
  // key = what the card opens when the reason is clicked
  const reasons: { key: string; light: Light; text: string }[] = [];
  const soon = s.daysToGoLive != null && s.daysToGoLive <= 3;
  if (s.openShowStopper) reasons.push({ key: 'ss', light: 'red', text: `${s.openShowStopper} תקלות Show Stopper פתוחות` });
  if (s.dailyRisk === 'HIGH') reasons.push({ key: 'daily', light: 'red', text: 'סיכון גבוה בניהול QA היומי' });
  if (s.hasTests && !s.testsFinished) reasons.push({ key: 'tests', light: soon ? 'red' : 'amber', text: soon ? 'הבדיקות לא הסתיימו ועלייה לאוויר בעוד ≤3 ימים' : 'הבדיקות טרם הסתיימו' });
  if (!s.hasTests) reasons.push({ key: 'tests', light: 'amber', text: 'אין בדיקות משויכות ל-CR ב-QC' });
  if (s.plan === 'partial' || s.plan === 'not-opened') {
    reasons.push({ key: 'plan', light: soon ? 'red' : 'amber', text: s.plan === 'not-opened' ? 'תוכנית ההטמעה לא נפתחה' : 'תוכנית ההטמעה לא הושלמה' });
  }
  if (s.openSevere) reasons.push({ key: 'severe', light: 'amber', text: `${s.openSevere} תקלות Severe פתוחות` });
  if (s.failedTests) reasons.push({ key: 'tests', light: 'amber', text: `${s.failedTests} בדיקות נכשלו` });
  if (s.openBlockers) reasons.push({ key: 'risks', light: 'amber', text: `${s.openBlockers} חסמים פתוחים` });
  if (s.highManualRisks) reasons.push({ key: 'risks', light: 'amber', text: `${s.highManualRisks} סיכונים בחומרה גבוהה פתוחים` });
  if (s.dailyRisk === 'MEDIUM') reasons.push({ key: 'daily', light: 'amber', text: 'סיכון בינוני בניהול QA היומי' });
  if (s.uatPlanned && !s.uatDone) reasons.push({ key: 'uat', light: 'amber', text: 'בדיקות המשתמשים (UAT) טרם הושלמו' });
  const light: Light = reasons.some(r => r.light === 'red') ? 'red' : reasons.length ? 'amber' : 'green';
  return { light, reasons };
}
