import { PrismaClient } from '@prisma/client';

// ONE Prisma client — one connection pool — for the whole server (regression
// 2026-10-10). Every service used to create its own `new PrismaClient()`: 42
// pools of ~(2 × CPUs + 1) connections each, so ordinary use of the app (one
// pass over the screens) filled Postgres's 100 connections and every module
// started failing at random with "too many clients already". Import this
// instead of constructing a client. The globalThis slot keeps a single client
// across watch-mode reloads.
const slot = globalThis as unknown as { __deployCenterPrisma?: PrismaClient };

export const prisma: PrismaClient = slot.__deployCenterPrisma ?? new PrismaClient();
slot.__deployCenterPrisma = prisma;
