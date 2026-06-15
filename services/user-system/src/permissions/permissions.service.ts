import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll() {
    return this.prisma.permission.findMany({
      where: { parentId: null }, include: { children: true }, orderBy: { createdAt: 'asc' },
    });
  }
  async create(data: CreatePermissionDto) { return this.prisma.permission.create({ data }); }
}
