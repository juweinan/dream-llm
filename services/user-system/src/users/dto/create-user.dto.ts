import { IsString, MinLength, IsBoolean, IsOptional } from 'class-validator';
export class CreateUserDto {
  @IsString() @MinLength(2) username: string;
  @IsString() @MinLength(6) password: string;
  @IsBoolean() @IsOptional() isSuperAdmin?: boolean;
}
