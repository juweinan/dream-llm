import { PermissionType } from '@prisma/client';
export declare class CreatePermissionDto {
    name: string;
    code: string;
    type: PermissionType;
    module: string;
    parentId?: string;
}
