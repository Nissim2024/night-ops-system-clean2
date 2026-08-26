// Root Cause Category → Root Cause (RCA) taxonomy, sourced 2026-08-09 from the
// user's real ALM/QC "Select Filter Condition" picklist (screenshots of the
// actual Root Cause Category / Root Cause fields). Entries marked below are
// NOT from that source — the user asked to have the gaps filled in, so these
// are inferred to match the naming pattern of the confirmed entries and
// explicitly flagged as unverified; correct them if they don't match the
// real system once more of it is visible.
//
// Confirmed from screenshots: Deployment, Design (partial — 2 of N items),
// Development, QA, Requirements. Category list itself (the 12 top-level
// names) is confirmed complete — it's a closed alphabetical list ending at
// "Requirements" that exactly matches the RCA tree's top-level folders.
export const ROOT_CAUSE_TAXONOMY: Record<string, string[]> = {
  Architecture: [
    // Not from the source system — inferred, unverified.
    'Missing Scalability Consideration',
    'Poor Separation of Concerns',
    'Single Point of Failure',
    'Tight Coupling Between Components',
  ],
  'Code Review': [
    // Not from the source system — inferred, unverified.
    'Approved Without Sufficient Review',
    'Missed Code Smell',
    'Reviewer Lacked Context',
  ],
  Configuration: [
    // Not from the source system — inferred, unverified.
    'Hardcoded Value',
    'Incorrect Parameter Value',
    'Missing Configuration Validation',
    'Wrong Environment Configuration',
  ],
  Deployment: [
    'Deployment Without Checklist',
    'Environment Mismatch',
    'Incorrect Production Configuration',
    'Missing Post-Deployment Testing',
  ],
  Design: [
    'Edge Cases Not Defined',
    'Missing Monitoring Design',
    // Below not from the source system — inferred, unverified (Design's full list was cut off in the screenshot).
    'Missing Rollback Design',
    'Unclear Interface Contract',
  ],
  Development: [
    'Incorrect Business Logic',
    'Merge Issues',
    'Missing Code Review',
    'Missing Edge Cases',
    'Missing Integration Tests',
    'Missing or Unclear Logs',
    'Missing Unit Tests',
    'Partial Devlopment of Requirement', // typo preserved verbatim from the source system
  ],
  Environment: [
    // Not from the source system — inferred, unverified.
    'Environment Drift',
    'Missing Environment Setup Step',
    'Resource Limitation',
    'Version Mismatch Between Environments',
  ],
  Integration: [
    // Not from the source system — inferred, unverified.
    'API Contract Mismatch',
    'Missing Integration Test Coverage',
    'Third-Party Service Failure',
    'Timing/Sequence Issue',
  ],
  Management: [
    // Not from the source system — inferred, unverified (screenshots never showed this category expanded).
    'Insufficient Resource Allocation',
    'Missed Risk Assessment',
    'Poor Communication Between Teams',
    'Unclear Ownership',
  ],
  Process: [
    // Not from the source system — inferred, unverified.
    'Deviation From Standard Process',
    'Missing Approval Step',
    'No Defined Process',
  ],
  QA: ['Coverage Gap', 'Exceptional Scenarios Not Tested', 'Known Issue', 'Lack of End-to-End Testing'],
  Requirements: ['Edge Cases Not Defined', 'Incomplete Requirement', 'Unclear Requirements', 'Uncommunicated Requirement Change'],
};

export const ROOT_CAUSE_CATEGORIES = Object.keys(ROOT_CAUSE_TAXONOMY);
