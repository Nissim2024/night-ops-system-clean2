/**
 * sync-assigned-users.ts — fuzzy matching + audit-log recovery
 *
 * For tasks whose assignedUserName was already set to "Missing" by a previous run,
 * we recover the original name from the most-recent audit log that stored it.
 *
 * Matching order:
 *  1. Exact fullName match
 *  2. Case-insensitive exact match
 *  3. Fuzzy: first name + last-name prefix  ("Ran S" → "Ran Shapiro")
 *  4. First-name-only (single token)
 *
 * Run: npx ts-node --project tsconfig.json scripts/sync-assigned-users.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const PREP_STATUSES = ['DRAFT', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED'];

type UserRow = Awaited<ReturnType<typeof loadUsers>>[0];

async function loadUsers() {
  return prisma.user.findMany({
    where: { active: true },
    include: {
      teamMemberships: { include: { team: { select: { id: true, name: true } } } },
    },
  });
}

function normalize(s: string) {
  return s.trim().replace(/\.$/, '').toLowerCase();
}

function matchUser(rawName: string, users: UserRow[]): UserRow | 'ambiguous' | null {
  const raw = rawName.trim();
  if (!raw) return null;

  // 1. Exact
  const exact = users.find(u => u.fullName === raw);
  if (exact) return exact;

  // 2. Case-insensitive exact
  const rawLow = raw.toLowerCase();
  const ciExact = users.find(u => u.fullName.toLowerCase() === rawLow);
  if (ciExact) return ciExact;

  // 3 & 4. Fuzzy: first-name + last-name prefix
  const tokens = raw.split(/\s+/);
  const firstToken = normalize(tokens[0]);
  const lastHint = tokens.length > 1 ? normalize(tokens.slice(1).join(' ')) : null;

  const candidates = users.filter(u => {
    const parts = u.fullName.trim().split(/\s+/);
    const uFirst = normalize(parts[0]);
    const uLast  = parts.length > 1 ? normalize(parts.slice(1).join(' ')) : '';
    if (uFirst !== firstToken) return false;
    if (!lastHint) return true;
    return uLast.startsWith(lastHint);
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return 'ambiguous';
}

async function main() {
  console.log('=== sync-assigned-users (fuzzy + audit recovery) ===\n');

  const users = await loadUsers();
  console.log(`Active users loaded: ${users.length}`);

  const prepVersions = await prisma.version.findMany({
    where: { status: { in: PREP_STATUSES as any } },
    select: { id: true, name: true, status: true },
  });
  console.log(`Preparation-stage versions: ${prepVersions.length}`);
  for (const v of prepVersions) console.log(`  • ${v.name} [${v.status}]`);
  console.log();

  if (prepVersions.length === 0) {
    console.log('אין גרסאות בשלב ההכנה — אין מה לעדכן.');
    return;
  }

  const prepVersionIds = prepVersions.map(v => v.id);

  const tasks = await prisma.task.findMany({
    where: { versionId: { in: prepVersionIds } },
    select: { id: true, assignedUserName: true, assignedUserId: true, assignedTeamId: true },
  });

  // ── Recover original names for "Missing" tasks ──────────────────────────
  // The sync script used direct Prisma (no audit log), so the most-recent
  // audit log for each task still holds the pre-sync assignedUserName.
  const missingTaskIds = tasks
    .filter(t => t.assignedUserName === 'Missing')
    .map(t => t.id);

  const originalNameMap = new Map<string, string>(); // taskId → recovered name

  if (missingTaskIds.length > 0) {
    // Fetch all audit logs for these tasks, ordered latest-first
    const logs = await prisma.auditLog.findMany({
      where: { taskId: { in: missingTaskIds } },
      orderBy: { createdAt: 'desc' },
      select: { taskId: true, afterData: true, createdAt: true },
    });

    // For each task, pick the most-recent log that has a usable assignedUserName
    for (const log of logs) {
      if (!log.taskId) continue;
      if (originalNameMap.has(log.taskId)) continue; // already found best entry
      const d = log.afterData as any;
      const name: string | undefined = d?.assignedUserName;
      if (name && name !== 'Missing') {
        originalNameMap.set(log.taskId, name);
      }
    }
    console.log(`Recovered original names via audit logs: ${originalNameMap.size} / ${missingTaskIds.length} "Missing" tasks`);

    const stillUnknown = missingTaskIds.length - originalNameMap.size;
    if (stillUnknown > 0) {
      console.log(`  → ${stillUnknown} "Missing" tasks have no usable audit log — will stay Missing`);
    }
    console.log();
  }

  // ── Determine which tasks to process ────────────────────────────────────
  const processable = tasks.filter(t => {
    if (!t.assignedUserName) return false;                           // null — skip
    if (t.assignedUserName === 'Missing') return originalNameMap.has(t.id); // recovered
    return true;                                                     // normal name
  });

  console.log(`Tasks to process: ${processable.length}\n`);

  let updated   = 0;
  let missing   = 0;
  let ambiguous = 0;
  let multiTeam = 0;

  const missingNames: Map<string, number> = new Map();
  const ambigNames:   Map<string, string[]> = new Map();
  const multiTeamNames: string[] = [];

  for (const task of processable) {
    const rawName = (
      task.assignedUserName === 'Missing'
        ? originalNameMap.get(task.id)
        : task.assignedUserName
    )?.trim() ?? '';

    if (!rawName) continue;

    const match = matchUser(rawName, users);

    // ── Not found ──
    if (match === null) {
      await prisma.task.update({ where: { id: task.id }, data: { assignedUserName: 'Missing' } });
      missingNames.set(rawName, (missingNames.get(rawName) ?? 0) + 1);
      missing++;
      continue;
    }

    // ── Ambiguous ──
    if (match === 'ambiguous') {
      const tokens = rawName.split(/\s+/);
      const firstToken = normalize(tokens[0]);
      const lastHint = tokens.length > 1 ? normalize(tokens.slice(1).join(' ')) : null;
      const candidateNames = users
        .filter(u => {
          const parts = u.fullName.trim().split(/\s+/);
          const uFirst = normalize(parts[0]);
          const uLast  = parts.length > 1 ? normalize(parts.slice(1).join(' ')) : '';
          if (uFirst !== firstToken) return false;
          if (!lastHint) return true;
          return uLast.startsWith(lastHint);
        })
        .map(u => u.fullName);
      if (!ambigNames.has(rawName)) ambigNames.set(rawName, candidateNames);
      ambiguous++;
      continue;
    }

    // ── Found ──
    const teams = match.teamMemberships;
    let teamId: string | undefined;

    if (teams.length === 1) {
      teamId = teams[0].team.id;
    } else if (teams.length > 1) {
      multiTeamNames.push(`${match.fullName} (${teams.map(t => t.team.name).join(', ')})`);
      multiTeam++;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        assignedUserId:   match.id,
        assignedUserName: match.fullName,
        ...(teamId !== undefined && { assignedTeamId: teamId }),
      },
    });
    updated++;
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════');
  console.log(`✅  עודכנו:             ${updated} משימות`);
  console.log(`❌  Missing:            ${missing} משימות`);
  console.log(`⚠️   דו-משמעי (דולג):  ${ambiguous} משימות`);
  console.log(`⚠️   ריבוי צוותות:     ${multiTeam} עובדים (צוות לא עודכן)`);
  console.log('══════════════════════════════════════════════\n');

  if (missingNames.size > 0) {
    console.log('שמות שלא נמצאו → Missing:');
    for (const [name, count] of missingNames)
      console.log(`  • "${name}" (${count} משימות)`);
    console.log();
  }

  if (ambigNames.size > 0) {
    console.log('שמות דו-משמעיים (לא עודכנו — נדרש טיפול ידני):');
    for (const [name, candidates] of ambigNames)
      console.log(`  ⚠️  "${name}" → מועמדים: ${candidates.join(', ')}`);
    console.log();
  }

  if (multiTeamNames.length > 0) {
    console.log('עובדים עם יותר מצוות אחד (userId עודכן, teamId לא):');
    for (const n of [...new Set(multiTeamNames)]) console.log(`  ⚠️  ${n}`);
    console.log();
  }
}

main()
  .catch(err => { console.error('שגיאה:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
