import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
export declare class PermissionsController {
    private readonly permissionsService;
    constructor(permissionsService: PermissionsService);
    findAll(): Promise<({
        children: {
            id: string;
            createdAt: Date;
            name: string;
            code: string;
            type: import("@prisma/client").$Enums.PermissionType;
            module: string;
            parentId: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        name: string;
        code: string;
        type: import("@prisma/client").$Enums.PermissionType;
        module: string;
        parentId: string | null;
    })[]>;
    create(dto: CreatePermissionDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        code: string;
        type: import("@prisma/client").$Enums.PermissionType;
        module: string;
        parentId: string | null;
    }>;
}
