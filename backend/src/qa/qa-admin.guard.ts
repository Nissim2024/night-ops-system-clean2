import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class QaAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('גישה לאזור QA מותרת למנהלי מערכת בלבד');
    if (user.role === 'ADMIN') return true;

    // Team leads who lead the QA team itself get the same access as ADMIN
    // here (same "qa" name-substring heuristic used client-side to detect
    // QA team membership) — everyone else stays blocked.
    if (user.role === 'TEAM_LEAD') {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.sub, team: { name: { contains: 'qa', mode: 'insensitive' } } },
      });
      if (membership) return true;
    }

    throw new ForbiddenException('גישה לאזור QA מותרת למנהלי מערכת בלבד');
  }
}
