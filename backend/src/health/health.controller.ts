import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

@Controller('health')
export class HealthController {
  @Get()
  async check() {
    const result: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? 'unknown',
      slot: process.env.SLOT ?? 'unknown',
      db: 'ok',
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      result.db = 'error';
      result.status = 'degraded';
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }
}
