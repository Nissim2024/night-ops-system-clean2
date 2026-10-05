import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service';

const permissions = new PermissionsService();

// QA admin area = permission action:qa_manage (AdminPanel → הרשאות → ניהול QA).
// The old hardcoded "lead of a team with 'qa' in its name" rule is now a team
// LEAD grant, migrated once (PermissionsService.migrateWiredActionsOnce), so
// it can be changed from the table like any other grant. ADMIN always passes.
@Injectable()
export class QaAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('גישה לאזור ניהול QA מותרת למורשים בלבד');
    if (await permissions.userHas(user, 'action:qa_manage')) return true;
    throw new ForbiddenException('אין לך הרשאת ניהול QA — פנה למנהל מערכת');
  }
}
