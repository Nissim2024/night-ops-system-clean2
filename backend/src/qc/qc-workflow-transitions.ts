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

// Union across every group the user belongs to (a user in more than one
// mapped team gets the combined set — matches how QC's own group
// permissions are additive when a user is in more than one group there).
export function getAllowedTransitions(qcGroupNames: string[], currentStatus: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const groupName of qcGroupNames) {
    const rules = QC_GROUP_TRANSITIONS[groupName];
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.from.toLowerCase() !== currentStatus.toLowerCase()) continue;
      const key = rule.to.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(rule.to);
    }
  }
  return result;
}
