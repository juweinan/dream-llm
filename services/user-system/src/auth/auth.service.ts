import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || user.status === 'DISABLED') throw new UnauthorizedException('用户名或密码错误');
    if (!(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('用户名或密码错误');

    const accessToken = this.signAccess(user);
    const refreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { token: this.hashToken(refreshToken), userId: user.id, deviceInfo: ip, expiresAt },
    });
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'LOGIN', resource: 'auth', ip },
    });
    return { accessToken, refreshToken };
  }

  async refresh(encrypted: string, ip?: string) {
    const hashed = this.hashToken(encrypted);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: hashed }, include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date())
      throw new UnauthorizedException('Refresh token 无效或已过期');

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const accessToken = this.signAccess(stored.user);
    const newRefresh = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { token: this.hashToken(newRefresh), userId: stored.user.id, deviceInfo: ip, expiresAt },
    });
    return { accessToken, refreshToken: newRefresh };
  }

  async logout(encrypted: string) {
    const hashed = this.hashToken(encrypted);
    await this.prisma.refreshToken.updateMany({
      where: { token: hashed, revokedAt: null }, data: { revokedAt: new Date() },
    });
  }

  private signAccess(user: { id: string; username: string; isSuperAdmin: boolean }) {
    return jwt.sign(
      { sub: user.id, username: user.username, isSuperAdmin: user.isSuperAdmin },
      ACCESS_SECRET, { expiresIn: '15m' },
    );
  }

  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
