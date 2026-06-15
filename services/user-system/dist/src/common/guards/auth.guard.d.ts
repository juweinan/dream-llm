import { CanActivate, ExecutionContext } from '@nestjs/common';
export interface JwtPayload {
    sub: string;
    username: string;
    isSuperAdmin: boolean;
}
export declare class AuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
