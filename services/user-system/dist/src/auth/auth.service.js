"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const node_crypto_1 = require("node:crypto");
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev';
let AuthService = class AuthService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async login(dto, ip) {
        const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
        if (!user || user.status === 'DISABLED')
            throw new common_1.UnauthorizedException('用户名或密码错误');
        if (!(await bcrypt.compare(dto.password, user.passwordHash)))
            throw new common_1.UnauthorizedException('用户名或密码错误');
        const accessToken = this.signAccess(user);
        const refreshToken = (0, node_crypto_1.randomBytes)(48).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.prisma.refreshToken.create({
            data: { token: this.hashToken(refreshToken), userId: user.id, deviceInfo: ip, expiresAt },
        });
        await this.prisma.auditLog.create({
            data: { userId: user.id, action: 'LOGIN', resource: 'auth', ip },
        });
        return { accessToken, refreshToken };
    }
    async refresh(encrypted, ip) {
        const hashed = this.hashToken(encrypted);
        const stored = await this.prisma.refreshToken.findUnique({
            where: { token: hashed }, include: { user: true },
        });
        if (!stored || stored.revokedAt || stored.expiresAt < new Date())
            throw new common_1.UnauthorizedException('Refresh token 无效或已过期');
        await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
        const accessToken = this.signAccess(stored.user);
        const newRefresh = (0, node_crypto_1.randomBytes)(48).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.prisma.refreshToken.create({
            data: { token: this.hashToken(newRefresh), userId: stored.user.id, deviceInfo: ip, expiresAt },
        });
        return { accessToken, refreshToken: newRefresh };
    }
    async logout(encrypted) {
        const hashed = this.hashToken(encrypted);
        await this.prisma.refreshToken.updateMany({
            where: { token: hashed, revokedAt: null }, data: { revokedAt: new Date() },
        });
    }
    signAccess(user) {
        return jwt.sign({ sub: user.id, username: user.username, isSuperAdmin: user.isSuperAdmin }, ACCESS_SECRET, { expiresIn: '15m' });
    }
    hashToken(token) { return (0, node_crypto_1.createHash)('sha256').update(token).digest('hex'); }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map