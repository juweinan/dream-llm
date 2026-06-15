import { AccountService } from './account.service';
import { JwtPayload } from '../common/guards/auth.guard';
export declare class AccountController {
    private readonly accountService;
    constructor(accountService: AccountService);
    getMe(user: JwtPayload): Promise<{
        user: {
            id: string;
            username: string;
            isSuperAdmin: boolean;
            status: import("@prisma/client").$Enums.UserStatus;
        };
        permissions: string[];
    }>;
}
