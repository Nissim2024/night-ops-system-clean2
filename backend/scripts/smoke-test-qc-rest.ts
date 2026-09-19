/**
 * DeployCenter — QC REST client smoke test (against mock-qc-server.ts)
 *
 * Exercises the REAL qc-rest.service.ts code (not curl) against the local
 * mock server, to catch bugs in our own client logic before Tuesday's real
 * QC test. Does NOT validate our assumptions about real QC's schema — see
 * mock-qc-server.ts's own header comment for that distinction.
 *
 * Prerequisites (this script does NOT set these up or revert them):
 *   1. mock-qc-server.ts running (npx ts-node scripts/mock-qc-server.ts)
 *   2. SystemParam QC_REST_BASE_URL temporarily pointed at the mock
 *      (e.g. http://localhost:3010), QC_REST_DOMAIN/PROJECT set to anything
 *   3. A real User row with qcLogin set to any non-empty string
 *
 * Usage:
 *   npx ts-node scripts/smoke-test-qc-rest.ts <userId>
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { QcRestService } from '../src/qc/qc-rest.service';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: npx ts-node scripts/smoke-test-qc-rest.ts <userId-with-qcLogin-set>');
    process.exit(1);
  }
  const svc = new QcRestService();

  console.log('\n=== 1. createReleaseWithCycles (Hebrew name + cycles) ===');
  const result = await svc.createReleaseWithCycles({
    releaseName: 'בדיקת מוק ITvTEST-2026',
    startDate: '2026-09-20',
    endDate: '2026-09-25',
    productionDate: '2026-09-24',
    year: '2026',
    cycles: [
      { name: 'Cycle 1', startDate: '2026-09-20', endDate: '2026-09-22', thresholdHigh: '0', thresholdMedium: '2', thresholdLow: '5' },
      { name: 'Dress Rehearsal', startDate: '2026-09-23', endDate: '2026-09-23' },
      { name: 'Go Live', startDate: '2026-09-24', endDate: '2026-09-24' },
    ],
  }, userId);
  console.log(JSON.stringify(result, null, 2));
  if (!result.release.id || result.cycles.some(c => !c.id)) {
    throw new Error('FAIL: release or a cycle did not get an id back');
  }
  if (result.release.raw.name !== 'בדיקת מוק ITvTEST-2026') {
    throw new Error(`FAIL: Hebrew release name corrupted on round-trip — got "${result.release.raw.name}"`);
  }
  console.log('OK — release + all cycles created, Hebrew name round-tripped intact.');

  console.log('\n=== 2. appendComment (Hebrew note, bold+bidi stamp) ===');
  // Pre-create a throwaway "defect" directly via createDefectRaw so appendComment has something to read/update.
  const defect = await svc.createDefectRaw({ name: 'בדיקת מוק — תקלה לצורך טסט' }, userId);
  if (!defect.id) throw new Error('FAIL: mock defect did not get an id back');
  const appended = await svc.appendComment(defect.id, 'זו הערת בדיקה עם עברית ואנגלית mixed content 123', userId);
  console.log('New dev-comments value:\n' + appended.newValue);
  if (!appended.newValue.includes('<b>') || !appended.newValue.includes('</b>')) {
    throw new Error('FAIL: bold tags missing from stamp');
  }
  if (!appended.newValue.includes('הערת בדיקה')) {
    throw new Error('FAIL: Hebrew note text missing/corrupted after round-trip');
  }
  console.log('OK — comment appended, bold tags present, Hebrew text intact after round-trip through our own XML build/parse.');

  console.log('\n=== 3. REQ folder walk + requirement creation ===');
  const folderId = await svc.walkFolderPath(
    'requirement-folders', 'requirement-folder',
    ['2026 Releases', 'HOT', 'ITvTEST-2026', 'Cycle 1', 'CR-99999'],
    userId,
  );
  console.log('Deepest folder id:', folderId);
  const req = await svc.createRequirementRaw(
    { name: 'CR-99999 בדיקת REQ עברית', 'parent-id': folderId, 'type-id': '5', 'user-02': 'CR-99999' },
    { 'target-rel': { id: result.release.id!, label: 'ITvTEST-2026' }, 'target-rcyc': { id: result.cycles[0].id!, label: 'Cycle 1' } },
    userId,
  );
  console.log(JSON.stringify(req, null, 2));
  if (!req.id) throw new Error('FAIL: requirement did not get an id back');
  if (req.raw['target-rel'] !== 'ITvTEST-2026' || req.raw.name !== 'CR-99999 בדיקת REQ עברית') {
    throw new Error('FAIL: requirement fields (incl. reference field) did not round-trip correctly');
  }
  // Re-running the same folder path must find the existing folders, not duplicate them.
  const folderId2 = await svc.walkFolderPath(
    'requirement-folders', 'requirement-folder',
    ['2026 Releases', 'HOT', 'ITvTEST-2026', 'Cycle 1', 'CR-99999'],
    userId,
  );
  if (folderId2 !== folderId) throw new Error('FAIL: walkFolderPath created a duplicate folder on re-run instead of finding the existing one');
  console.log('OK — requirement created with reference fields intact, folder walk is idempotent on re-run.');

  console.log('\n=== 4. Tier 2 field editing (business-key -> REST-name translation) ===');
  const PrismaClient = require('@prisma/client').PrismaClient;
  const prisma = new PrismaClient();
  try {
    // Should refuse while unconfigured (default seed state).
    let refused = false;
    try {
      await svc.updateDefectTier2Fields(defect.id, { priority: 'High' }, userId);
    } catch (e: any) {
      refused = true;
      if (!String(e.message).includes('לא הוגדר')) throw new Error(`FAIL: wrong refusal message: ${e.message}`);
    }
    if (!refused) throw new Error('FAIL: should have refused an unconfigured Tier 2 field');
    console.log('OK — refuses to write an unconfigured field mapping (as designed).');

    // Configure a mapping, then verify it actually reaches the right REST field.
    await prisma.systemParam.update({ where: { key: 'QC_REST_FIELD_PRIORITY' }, data: { value: 'user-05' } });
    await svc.updateDefectTier2Fields(defect.id, { priority: 'High' }, userId);
    const fetched = await svc.listAllFields(defect.id, userId);
    if (fetched['user-05'] !== 'High') throw new Error(`FAIL: priority did not reach the configured REST field — got ${JSON.stringify(fetched)}`);
    console.log('OK — business key "priority" correctly translated to configured REST field "user-05".');

    // Unknown business key must be rejected server-side regardless of config.
    let rejectedUnknown = false;
    try {
      await svc.updateDefectTier2Fields(defect.id, { statusRaw: 'Closed' } as any, userId);
    } catch (e: any) {
      rejectedUnknown = true;
    }
    if (!rejectedUnknown) throw new Error('FAIL: an unknown business key should always be rejected, config or not');
    console.log('OK — unknown business keys are rejected regardless of SystemParam config (allowlist is server-enforced).');
  } finally {
    await prisma.systemParam.update({ where: { key: 'QC_REST_FIELD_PRIORITY' }, data: { value: '' } });
    await prisma.$disconnect();
  }

  console.log('\n=== ALL SMOKE TESTS PASSED (client-code level — does not validate real-QC assumptions) ===');
  console.log('NOTE: publishCrRequirement/publishPendingReqsForVersion (the full DB-backed orchestration) were NOT exercised here — they need a real Version+QaWorkPlan+QaCycle+QaAssignment fixture, not just the QC-side mock.');
}

main().catch(err => {
  console.error('\nSMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
