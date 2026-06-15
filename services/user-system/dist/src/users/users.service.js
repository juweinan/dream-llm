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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const bcrypt = require("bcryptjs");
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                skip, take: limit,
                select: { id: true, username: true, isSuperAdmin: true, status: true, createdAt: true,
                    userRoles: { include: { role: { select: { id: true, name: true } } } } },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.user.count(),
        ]);
        return { items, total, page, limit };
    }
    async create(dto) {
        if (await this.prisma.user.findUnique({ where: { username: dto.username } }))
            throw new common_1.ConflictException('用户名已存在');
        const passwordHash = await bcrypt.hash(dto.password, 12);
        return this.prisma.user.create({
            data: { username: dto.username, passwordHash, isSuperAdmin: dto.isSuperAdmin || false },
            select: { id: true, username: true, isSuperAdmin: true, status: true, createdAt: true },
        });
    }
    async update(id, dto) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user)
            throw new common_1.NotFoundException('用户不存在');
        const data = {};
        if (dto.username)
            data.username = dto.username;
        if (dto.password)
            data.passwordHash = await bcrypt.hash(dto.password, 12);
        if (dto.status)
            data.status = dto.status;
        return this.prisma.user.update({ where: { id }, data,
            select: { id: true, username: true, isSuperAdmin: true, status: true } });
    }
    async assignRoles(userId, dto) {
        if (!(await this.prisma.user.findUnique({ where: { id: userId } })))
            throw new common_1.NotFoundException('用户不存在');
        await this.prisma.userRole.deleteMany({ where: { userId } });
        await this.prisma.userRole.createMany({ data: dto.roleIds.map((roleId) => ({ userId, roleId })) });
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, userRoles: { include: { role: true } } },
        });
    }
    async remove(id) {
        await this.prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
        return { message: '用户已禁用' };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map