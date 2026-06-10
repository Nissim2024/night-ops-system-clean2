import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class LeavesService {

  // ── Seasons ──────────────────────────────────────────────────────────────────

  async getSeasons() {
    return prisma.season.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        dates: { orderBy: { orderIndex: 'asc' } },
      },
    });
  }

  async createSeason(data: { name: string; dateRange: string; isActive?: boolean; sortOrder?: number }) {
    return prisma.season.create({ data, include: { dates: true } });
  }

  async updateSeason(id: string, data: { name?: string; dateRange?: string; isActive?: boolean; sortOrder?: number }) {
    return prisma.season.update({ where: { id }, data, include: { dates: true } });
  }

  async addSeasonDate(seasonId: string, data: { date: string; label: string; type: string; orderIndex?: number }) {
    await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    return prisma.seasonDate.create({
      data: {
        seasonId,
        date: new Date(data.date),
        label: data.label,
        type: data.type,
        orderIndex: data.orderIndex ?? 0,
      },
    });
  }

  // ── Requests — employee ──────────────────────────────────────────────────────

  async getMyRequests(userId: string) {
    return prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      include: { season: { select: { id: true, name: true } } },
    });
  }

  async submitRequest(userId: string, data: { seasonId?: string; date: string; kind: string; reason?: string }) {
    const existing = await prisma.leaveRequest.findFirst({
      where: { userId, date: new Date(data.date) },
    });
    if (existing) {
      return prisma.leaveRequest.update({
        where: { id: existing.id },
        data: { kind: data.kind, reason: data.reason ?? null, status: 'PENDING' },
        include: { season: { select: { id: true, name: true } } },
      });
    }
    return prisma.leaveRequest.create({
      data: {
        userId,
        seasonId: data.seasonId ?? null,
        date: new Date(data.date),
        kind: data.kind,
        reason: data.reason ?? null,
        status: 'PENDING',
      },
      include: { season: { select: { id: true, name: true } } },
    });
  }

  async cancelRequest(userId: string, requestId: string) {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    if (req.userId !== userId) throw new ForbiddenException('אין הרשאה לבטל בקשה זו');
    await prisma.leaveRequest.delete({ where: { id: requestId } });
    return { ok: true };
  }

  // ── Requests — admin ─────────────────────────────────────────────────────────

  async getAllRequests(seasonId?: string) {
    return prisma.leaveRequest.findMany({
      where: seasonId ? { seasonId } : undefined,
      orderBy: { date: 'asc' },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }

  async updateRequestStatus(requestId: string, status: 'APPROVED' | 'DECLINED') {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    return prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }
}
