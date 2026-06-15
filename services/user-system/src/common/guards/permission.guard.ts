import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('未认证');
    if (user.isSuperAdmin) return true;

    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.sub },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    const codes = new Set<string>();
    for (const ur of userRoles)
      for (const rp of ur.role.rolePermissions)
        codes.add(rp.permission.code);

    if (!codes.has(required)) throw new ForbiddenException(`缺少权限: ${required}`);
    return true;
  }
}
