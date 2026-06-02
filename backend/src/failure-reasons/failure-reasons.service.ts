import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class FailureReasonsService {
  async findAll() {
    return (prisma as any).failureReason.findMany({
      orderBy: [{ requiresRollback: 'desc' }, { reason: 'asc' }],
    });
  }

  async create(reason: string, requiresRollback: boolean) {
    const existing = await (prisma as any).failureReason.findFirst({
      where: { reason: reason.trim() },
    });
    if (existing) throw new ConflictException(`הסיבה "${reason}" כבר קיימת`);
    return (prisma as any).failureReason.create({
      data: { reason: reason.trim(), requiresRollback, isActive: true },
    });
  }

  async update(id: string, data: { reason?: string; requiresRollback?: boolean; isActive?: boolean }) {
    const existing = await (prisma as any).failureReason.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('סיבת כישלון לא נמצאה');
    return (prisma as any).failureReason.update({
      where: { id },
      data: {
        ...(data.reason !== undefined && { reason: data.reason.trim() }),
        ...(data.requiresRollback !== undefined && { requiresRollback: data.requiresRollback }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    const existing = await (prisma as any).failureReason.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('סיבת כישלון לא נמצאה');
    return (prisma as any).failureReason.delete({ where: { id } });
  }
}
