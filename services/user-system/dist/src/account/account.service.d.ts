import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/guards/auth.guard';
export declare class AccountService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getMe(payload: JwtPayload): Promise<{
        user: {
            id: string;
            username: string;
            isSuperAdmin: boolean;
            status: import("@prisma/client").$Enums.UserStatus;
        };
        permissions: string[];
    }>;
}
