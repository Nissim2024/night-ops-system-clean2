// Real QC Bug Status workflow transition rules, per QC group — manually
// transcribed from QC's own Project Customization > Groups and Permissions
// > Defects > Update > Bug Status > Transition Rules screen (2026-09-18,
// reviewed directly with the user from screenshots, not an API pull — see
// project memory project-qc-workflow-transitions-2026-09-18 for why: no
// verified way to pull group membership or these rules live from QC exists
// yet, and building one would be another unverified integration surface on
// top of everything else already waiting on Tuesday's real QC access).
//
// Self-transitions (From === To, e.g. "New"->"New") are confirmed no-ops
// (saving the record without changing status) and deliberately excluded —
// they're not real transitions to offer as an option.
//
// Status casing is inconsistent across the source screenshots (e.g. "open"
// vs "Open" for what's presumably the same value) — matching in
// getAllowedTransitions is case-insensitive, but the returned "to" values
// preserve whatever casing was actually observed, so callers should not
// assume a fixed casing when displaying them.
//
// Only the 3 groups the user identified as actually needed (2026-09-18):
// QA, Dev, Operations. More can be added the same way if/when needed.
export const QC_GROUP_TRANSITIONS: Record<string, { from: string; to: string }[]> = {
  QATesters_New: [
    { from: 'New', to: 'Open' },
    { from: 'Fixed_Test', to: 'Reopen' },
    { from: 'Fixed_Test', to: 'Closed' },
    { from: 'Rejected', to: 'Open' },
    { from: 'Closed', to: 'Reopen' },
    { from: 'At Work', to: 'Open' },
    { from: 'Reopen', to: 'At Work' },
    { from: 'Rejected', to: 'Canceled' },
    { from: 'Pending', to: 'Open' },
  ],
  Developer_New: [
    { from: 'New', to: 'open' },
    { from: 'open', to: 'Fixed_Dev' },
    { from: 'open', to: 'Rejected' },
    { from: 'open', to: 'At Work' },
    { from: 'Fixed_Dev', to: 'Fixed_Test' },
    { from: 'Fixed_Dev', to: 'At Work' },
    { from: 'Fixed_Test', to: 'Reopen' },
    { from: 'Rejected', to: 'open' },
    { from: 'Closed', to: 'Reopen' },
    { from: 'At Work', to: 'Fixed_Dev' },
    { from: 'At Work', to: 'Rejected' },
    { from: 'Reopen', to: 'Fixed_Dev' },
    { from: 'Reopen', to: 'Rejected' },
    { from: 'Reopen', to: 'At Work' },
    { from: 'Rejected', to: 'At Work' },
    { from: 'Rejected', to: 'Open' },
  ],
  HotSupport: [
    { from: 'Rejected', to: 'Canceled' },
    { from: 'Rejected', to: 'Open' },
    { from: 'Fixed_Test', to: 'Closed' },
    { from: 'Fixed_Test', to: 'Reopen' },
    { from: 'Closed', to: 'Reopen' },
    { from: 'New', to: 'Open' },
    { from: 'Open', to: 'Rejected' },
    { from: 'Pending', to: 'Open' },
    { from: 'Canceled', to: 'Open' },
  ],
};

// Role overrides (user, 2026-10-07):
//  - ADMIN and RELEASE_MANAGER: every transition of every group, and ONLY
//    they may move a defect to Pending (all other Pending transitions were
//    removed in QC on purpose).
//  - CR_MANAGER: the developers' rules (Developer_New).
// Enforcement stays in QC for now — this only decides what the form offers.
export const PENDING_STATUS = 'Pending';
const PRIVILEGED_ROLES = ['ADMIN', 'RELEASE_MANAGER'];

export function getAllowedTransitionsForUser(
  role: string, teamGroups: string[], currentStatus: string,
  rules: Record<string, { from: string; to: string }[]> = QC_GROUP_TRANSITIONS,
): { hasMapping: boolean; allowed: string[] } {
  if (PRIVILEGED_ROLES.includes(role)) {
    const all = getAllowedTransitions(Object.keys(rules), currentStatus, rules);
    if (currentStatus.toLowerCase() !== PENDING_STATUS.toLowerCase() && !all.some(s => s.toLowerCase() === 'pending')) all.push(PENDING_STATUS);
    return { hasMapping: true, allowed: all };
  }
  const groups = [...teamGroups, ...(role === 'CR_MANAGER' ? ['Developer_New'] : [])];
  if (groups.length === 0) return { hasMapping: false, allowed: [] };
  return { hasMapping: true, allowed: getAllowedTransitions(groups, currentStatus, rules) };
}

// Union across every group the user belongs to (a user in more than one
// mapped team gets the combined set — matches how QC's own group
// permissions are additive when a user is in more than one group there).
export function getAllowedTransitions(
  qcGroupNames: string[], currentStatus: string,
  rules: Record<string, { from: string; to: string }[]> = QC_GROUP_TRANSITIONS,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const groupName of qcGroupNames) {
    const groupRules = rules[groupName];
    if (!groupRules) continue;
    for (const rule of groupRules) {
      if (rule.from.toLowerCase() !== currentStatus.toLowerCase()) continue;
      const key = rule.to.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(rule.to);
    }
  }
  return result;
}
