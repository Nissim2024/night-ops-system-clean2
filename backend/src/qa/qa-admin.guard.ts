import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class QaAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('גישה לאזור QA מותרת למנהלי מערכת בלבד');
    }
    return true;
  }
}
