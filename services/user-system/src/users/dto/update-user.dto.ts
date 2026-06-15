import { IsString, IsOptional, IsEnum, MinLength } from 'class-validator';
import { UserStatus } from '@prisma/client';
export class UpdateUserDto {
  @IsString() @IsOptional() username?: string;
  @IsString() @MinLength(6) @IsOptional() password?: string;
  @IsEnum(UserStatus) @IsOptional() status?: UserStatus;
}
