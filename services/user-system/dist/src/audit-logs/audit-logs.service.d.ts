import { PrismaService } from '../prisma/prisma.service';
export declare class AuditLogsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(params: {
        page: number;
        limit: number;
        action?: string;
        userId?: string;
    }): Promise<{
        items: ({
            user: {
                id: string;
                username: string;
            } | null;
        } & {
            id: string;
            createdAt: Date;
            userId: string | null;
            action: import("@prisma/client").$Enums.AuditAction;
            resource: string;
            resourceId: string | null;
            detail: string | null;
            ip: string | null;
        })[];
        total: number;
        page: number;
        limit: number;
    }>;
}
