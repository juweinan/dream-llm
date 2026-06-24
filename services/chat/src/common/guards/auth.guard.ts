import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev';

export interface JwtPayload {
  sub: string;
  username: string;
  isSuperAdmin: boolean;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 从 http 请求头里获取 authorization
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 access token');
    }
    try {
      (req as any).user = jwt.verify(
        header.slice(7),
        ACCESS_SECRET,
      ) as JwtPayload;
      // 从 jwt 里成功获取信息，然后继续走到后续的 controller 中
      return true;
    } catch {
      throw new UnauthorizedException('access token 无效或已过期');
    }
  }
}
