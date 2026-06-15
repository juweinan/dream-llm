import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(page?: number, limit?: number): Promise<{
        items: {
            id: string;
            username: string;
            isSuperAdmin: boolean;
            status: import("@prisma/client").$Enums.UserStatus;
            createdAt: Date;
            userRoles: ({
                role: {
                    id: string;
                    name: string;
                };
            } & {
                roleId: string;
                userId: string;
            })[];
        }[];
        total: number;
        page: number;
        limit: number;
    }>;
    create(dto: CreateUserDto): Promise<{
        id: string;
        username: string;
        isSuperAdmin: boolean;
        status: import("@prisma/client").$Enums.UserStatus;
        createdAt: Date;
    }>;
    update(id: string, dto: UpdateUserDto): Promise<{
        id: string;
        username: string;
        isSuperAdmin: boolean;
        status: import("@prisma/client").$Enums.UserStatus;
    }>;
    assignRoles(userId: string, dto: AssignRolesDto): Promise<{
        id: string;
        username: string;
        userRoles: ({
            role: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                name: string;
                code: string;
                description: string | null;
            };
        } & {
            roleId: string;
            userId: string;
        })[];
    } | null>;
    remove(id: string): Promise<{
        message: string;
    }>;
}
