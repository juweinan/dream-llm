import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll(params: { page: number; limit: number; action?: string; userId?: string }) {
    const { page, limit, action, userId } = params;
    const where: any = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, skip: (page - 1) * limit, take: limit,
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, limit };
  }
}
