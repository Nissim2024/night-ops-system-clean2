import { PrismaClient } from '@prisma/client';

// ONE Prisma client — one connection pool — for the whole server (regression
// 2026-10-10). Every service used to create its own `new PrismaClient()`: 42
// pools of ~(2 × CPUs + 1) connections each, so ordinary use of the app (one
// pass over the screens) filled Postgres's 100 connections and every module
// started failing at random with "too many clients already". Import this
// instead of constructing a client. The globalThis slot keeps a single client
// across watch-mode reloads.
const slot = globalThis as unknown as { __deployCenterPrisma?: PrismaClient };

// The pool size is set explicitly (not left to Prisma's 2 × CPUs + 1, which on
// a 2-core server is 5 connections — 150 users would queue): 20 by default,
// DB_POOL_SIZE overrides; well under Postgres's 100.
function withPool(url: string | undefined): string | undefined {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  const size = Math.max(5, Number(process.env.DB_POOL_SIZE) || 20);
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${size}&pool_timeout=20`;
}

export const prisma: PrismaClient = slot.__deployCenterPrisma
  ?? new PrismaClient({ datasources: { db: { url: withPool(process.env.DATABASE_URL) } } });
slot.__deployCenterPrisma = prisma;
