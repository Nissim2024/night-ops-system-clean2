import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const version = await prisma.version.findFirst({ where: { name: 'ITv04-2026' }, select: { id: true } });
  if (!version) { console.log('Version not found'); return; }
  const taskIds = (await prisma.task.findMany({ where: { versionId: version.id }, select: { id: true } })).map(t => t.id);
  const logCount = await prisma.auditLog.count({ where: { taskId: { in: taskIds } } });
  const sample = await prisma.auditLog.findFirst({ where: { taskId: { in: taskIds } }, select: { action: true, afterData: true, taskId: true } });
  console.log('Audit logs total:', logCount);
  if (sample) {
    const d = sample.afterData as any;
    console.log('Action:', sample.action);
    console.log('assignedUserName in afterData:', d?.assignedUserName);
  } else {
    console.log('No audit logs found for these tasks');
  }
  // Check tasks currently set to Missing
  const missingCount = await prisma.task.count({ where: { versionId: version.id, assignedUserName: 'Missing' } });
  console.log('Tasks with Missing:', missingCount);
}
main().catch(console.error).finally(() => prisma.$disconnect());
