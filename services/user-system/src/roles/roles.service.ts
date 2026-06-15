import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.role.findMany({
      include: { _count: { select: { userRoles: true, rolePermissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id }, include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async create(dto: CreateRoleDto) {
    if (await this.prisma.role.findUnique({ where: { code: dto.code } }))
      throw new ConflictException('角色 code 已存在');
    return this.prisma.role.create({ data: dto });
  }

  async update(id: string, dto: UpdateRoleDto) {
    await this.findOne(id);
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async assignPermissions(roleId: string, dto: AssignPermissionsDto) {
    await this.findOne(roleId);
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    await this.prisma.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({ roleId, permissionId })),
    });
    return this.findOne(roleId);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.role.delete({ where: { id } });
    return { message: '角色已删除' };
  }
}
