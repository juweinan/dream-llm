import { UserStatus } from '@prisma/client';
export declare class UpdateUserDto {
    username?: string;
    password?: string;
    status?: UserStatus;
}
