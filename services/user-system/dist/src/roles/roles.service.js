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
exports.RolesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let RolesService = class RolesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        return this.prisma.role.findMany({
            include: { _count: { select: { userRoles: true, rolePermissions: true } } },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id) {
        const role = await this.prisma.role.findUnique({
            where: { id }, include: { rolePermissions: { include: { permission: true } } },
        });
        if (!role)
            throw new common_1.NotFoundException('角色不存在');
        return role;
    }
    async create(dto) {
        if (await this.prisma.role.findUnique({ where: { code: dto.code } }))
            throw new common_1.ConflictException('角色 code 已存在');
        return this.prisma.role.create({ data: dto });
    }
    async update(id, dto) {
        await this.findOne(id);
        return this.prisma.role.update({ where: { id }, data: dto });
    }
    async assignPermissions(roleId, dto) {
        await this.findOne(roleId);
        await this.prisma.rolePermission.deleteMany({ where: { roleId } });
        await this.prisma.rolePermission.createMany({
            data: dto.permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
        return this.findOne(roleId);
    }
    async remove(id) {
        await this.findOne(id);
        await this.prisma.role.delete({ where: { id } });
        return { message: '角色已删除' };
    }
};
exports.RolesService = RolesService;
exports.RolesService = RolesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RolesService);
//# sourceMappingURL=roles.service.js.map