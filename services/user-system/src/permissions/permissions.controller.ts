import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('api/permissions')
@UseGuards(AuthGuard, SuperAdminGuard, PermissionGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}
  @Get() @Permissions('permission:page:view') findAll() { return this.permissionsService.findAll(); }
  @Post() @Permissions('permission:page:view') create(@Body() dto: CreatePermissionDto) { return this.permissionsService.create(dto); }
}
