import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return true; // 非 super_admin 交给 PermissionGuard
  }
}
