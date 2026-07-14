import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class QaAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('גישה לאזור QA מותרת למנהלי מערכת בלבד');
    if (user.role === 'ADMIN') return true;

    // Whoever leads the QA team gets the same access as ADMIN here, ON TOP
    // of whatever their own base role is — e.g. a RELEASE_MANAGER ("מנהל
    // הלילה") who is also QA team lead shouldn't be blocked just because
    // their primary role isn't TEAM_LEAD. isLead is required so this stays
    // scoped to the QA team's actual lead, not just any member of it (same
    // "qa" name-substring heuristic used client-side to detect the team).
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub, isLead: true, team: { name: { contains: 'qa', mode: 'insensitive' } } },
    });
    if (membership) return true;

    throw new ForbiddenException('גישה לאזור QA מותרת למנהלי מערכת בלבד');
  }
}
