import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('api/users')
@UseGuards(AuthGuard, SuperAdminGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get() @Permissions('user:page:view')
  findAll(@Query('page') p?: string, @Query('limit') l?: string) {
    return this.usersService.findAll(Number(p) || 1, Number(l) || 20);
  }

  @Post() @Permissions('user:button:create')
  create(@Body() dto: CreateUserDto) { return this.usersService.create(dto); }

  @Patch(':id') @Permissions('user:button:edit')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.usersService.update(id, dto); }

  @Patch(':id/roles') @Permissions('user:button:assign-role')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) { return this.usersService.assignRoles(id, dto); }

  @Delete(':id') @Permissions('user:button:delete')
  remove(@Param('id') id: string) { return this.usersService.remove(id); }
}
