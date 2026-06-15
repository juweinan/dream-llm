import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        skip, take: limit,
        select: { id: true, username: true, isSuperAdmin: true, status: true, createdAt: true,
          userRoles: { include: { role: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);
    return { items, total, page, limit };
  }

  async create(dto: CreateUserDto) {
    if (await this.prisma.user.findUnique({ where: { username: dto.username } }))
      throw new ConflictException('用户名已存在');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: { username: dto.username, passwordHash, isSuperAdmin: dto.isSuperAdmin || false },
      select: { id: true, username: true, isSuperAdmin: true, status: true, createdAt: true },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    const data: any = {};
    if (dto.username) data.username = dto.username;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);
    if (dto.status) data.status = dto.status;
    return this.prisma.user.update({ where: { id }, data,
      select: { id: true, username: true, isSuperAdmin: true, status: true } });
  }

  async assignRoles(userId: string, dto: AssignRolesDto) {
    if (!(await this.prisma.user.findUnique({ where: { id: userId } })))
      throw new NotFoundException('用户不存在');
    await this.prisma.userRole.deleteMany({ where: { userId } });
    await this.prisma.userRole.createMany({ data: dto.roleIds.map((roleId) => ({ userId, roleId })) });
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, userRoles: { include: { role: true } } },
    });
  }

  async remove(id: string) {
    await this.prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
    return { message: '用户已禁用' };
  }
}
