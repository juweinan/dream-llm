import { PrismaService } from '../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
export declare class PermissionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    create(data: CreatePermissionDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        code: string;
        type: import("@prisma/client").$Enums.PermissionType;
        module: string;
        parentId: string | null;
    }>;
}
