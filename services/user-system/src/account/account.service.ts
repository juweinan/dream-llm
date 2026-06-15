import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/guards/auth.guard';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}
  async getMe(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isSuperAdmin: true, status: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    const permissions = new Set<string>();
    for (const ur of userRoles)
      for (const rp of ur.role.rolePermissions)
        permissions.add(rp.permission.code);
    return { user, permissions: [...permissions] };
  }
}
