import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { PERMISSION_CATALOG } from './permission-catalog';

// Server-side module access (user ask 2026-10-05: a module that isn't granted
// must be blocked by the API too, not only hidden in the UI).
//
//   @ModuleAccess('module:x', 'module:y')  - caller needs ANY part of x or y
//   @ModuleAccess()                         - open to every signed-in user
//                                             (endpoints shared with home
//                                             pages / other modules)
// Handler metadata overrides the controller's. Use after JwtGuard in the
// same @UseGuards(...) so req.user is set. ADMIN always passes.
export const MODULE_ACCESS_KEY = 'moduleAccess';
export const ModuleAccess = (...modules: string[]) => SetMetadata(MODULE_ACCESS_KEY, modules);

const permissions = new PermissionsService();
const LABEL = new Map(PERMISSION_CATALOG.map(m => [m.key, m.label]));

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const modules = this.reflector.getAllAndOverride<string[] | undefined>(MODULE_ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!modules || modules.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('נדרשת התחברות');
    if (user.role === 'ADMIN') return true;
    const effective = await permissions.getEffective(user);
    if (modules.some(m => effective.includes(`partial:${m}`))) return true;
    throw new ForbiddenException(`אין לך הרשאה למודול ${modules.map(m => LABEL.get(m) ?? m).join(' / ')} — פנה למנהל מערכת`);
  }
}
