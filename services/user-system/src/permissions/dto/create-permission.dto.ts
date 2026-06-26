import { IsString, IsEnum, IsOptional } from 'class-validator';
import { PermissionType } from '../../prisma/generated';
export class CreatePermissionDto {
  @IsString() name: string;
  @IsString() code: string;
  @IsEnum(PermissionType) type: PermissionType;
  @IsString() module: string;
  @IsString() @IsOptional() parentId?: string;
}
