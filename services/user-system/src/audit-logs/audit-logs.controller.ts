import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('api/audit-logs')
@UseGuards(AuthGuard, SuperAdminGuard, PermissionGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}
  @Get() @Permissions('audit:page:view')
  findAll(@Query('page') p?: string, @Query('limit') l?: string, @Query('action') a?: string, @Query('userId') u?: string) {
    return this.auditLogsService.findAll({ page: Number(p) || 1, limit: Number(l) || 20, action: a, userId: u });
  }
}
