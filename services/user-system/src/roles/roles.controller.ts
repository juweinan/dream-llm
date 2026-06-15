import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('api/roles')
@UseGuards(AuthGuard, SuperAdminGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get() @Permissions('role:page:view') findAll() { return this.rolesService.findAll(); }
  @Get(':id') @Permissions('role:page:view') findOne(@Param('id') id: string) { return this.rolesService.findOne(id); }
  @Post() @Permissions('role:button:create') create(@Body() dto: CreateRoleDto) { return this.rolesService.create(dto); }
  @Patch(':id') @Permissions('role:button:edit') update(@Param('id') id: string, @Body() dto: UpdateRoleDto) { return this.rolesService.update(id, dto); }
  @Patch(':id/permissions') @Permissions('role:button:assign-permission') assignPermissions(@Param('id') id: string, @Body() dto: AssignPermissionsDto) { return this.rolesService.assignPermissions(id, dto); }
  @Delete(':id') @Permissions('role:button:delete') remove(@Param('id') id: string) { return this.rolesService.remove(id); }
}
