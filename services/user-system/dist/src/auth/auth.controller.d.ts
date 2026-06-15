import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    private setCookie;
    login(dto: LoginDto, ip: string, res: Response): Promise<{
        accessToken: string;
    }>;
    refresh(req: Request, ip: string, res: Response): Promise<{
        accessToken: string;
    } | undefined>;
    logout(req: Request): Promise<{
        message: string;
    }>;
}
