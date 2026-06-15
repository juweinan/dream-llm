import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';
export declare class RolesController {
    private readonly rolesService;
    constructor(rolesService: RolesService);
    findAll(): Promise<({
        _count: {
            userRoles: number;
            rolePermissions: number;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        description: string | null;
    })[]>;
    findOne(id: string): Promise<{
        rolePermissions: ({
            permission: {
                id: string;
                createdAt: Date;
                name: string;
                code: string;
                type: import("@prisma/client").$Enums.PermissionType;
                module: string;
                parentId: string | null;
            };
        } & {
            roleId: string;
            permissionId: string;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        description: string | null;
    }>;
    create(dto: CreateRoleDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        description: string | null;
    }>;
    update(id: string, dto: UpdateRoleDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        description: string | null;
    }>;
    assignPermissions(id: string, dto: AssignPermissionsDto): Promise<{
        rolePermissions: ({
            permission: {
                id: string;
                createdAt: Date;
                name: string;
                code: string;
                type: import("@prisma/client").$Enums.PermissionType;
                module: string;
                parentId: string | null;
            };
        } & {
            roleId: string;
            permissionId: string;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        description: string | null;
    }>;
    remove(id: string): Promise<{
        message: string;
    }>;
}
