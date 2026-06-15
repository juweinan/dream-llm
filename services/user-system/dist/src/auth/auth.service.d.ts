import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
export declare class AuthService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    login(dto: LoginDto, ip?: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    refresh(encrypted: string, ip?: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    logout(encrypted: string): Promise<void>;
    private signAccess;
    private hashToken;
}
