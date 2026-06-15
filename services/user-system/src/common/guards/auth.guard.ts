import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev';

export interface JwtPayload { sub: string; username: string; isSuperAdmin: boolean; }

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('缺少 access token');
    try {
      (req as any).user = jwt.verify(header.slice(7), ACCESS_SECRET) as JwtPayload;
      return true;
    } catch { throw new UnauthorizedException('access token 无效或已过期'); }
  }
}
