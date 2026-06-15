import { AuditLogsService } from './audit-logs.service';
export declare class AuditLogsController {
    private readonly auditLogsService;
    constructor(auditLogsService: AuditLogsService);
    findAll(p?: string, l?: string, a?: string, u?: string): Promise<{
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
