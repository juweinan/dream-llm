import { IsString, IsOptional, IsArray } from 'class-validator';
export class CreateRoleDto { @IsString() name: string; @IsString() code: string; @IsString() @IsOptional() description?: string; }
export class UpdateRoleDto { @IsString() @IsOptional() name?: string; @IsString() @IsOptional() description?: string; }
export class AssignPermissionsDto { @IsArray() @IsString({ each: true }) permissionIds: string[]; }
