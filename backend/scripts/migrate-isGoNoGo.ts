import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function main() {
  const result = await prisma.$executeRaw`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY "versionId" ORDER BY "orderIndex" DESC) as rn
      FROM "Phase"
    )
    UPDATE "Phase"
    SET "isGoNoGo" = true
    FROM ranked
    WHERE "Phase".id = ranked.id AND ranked.rn = 2
  `;
  console.log(`Updated ${result} phases with isGoNoGo=true`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
