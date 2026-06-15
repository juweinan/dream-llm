import { CanActivate, ExecutionContext } from '@nestjs/common';
export declare class SuperAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
