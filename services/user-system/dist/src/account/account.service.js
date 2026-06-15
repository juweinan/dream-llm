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
exports.AccountService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AccountService = class AccountService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getMe(payload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, username: true, isSuperAdmin: true, status: true },
        });
        if (!user)
            throw new common_1.NotFoundException('用户不存在');
        const userRoles = await this.prisma.userRole.findMany({
            where: { userId: user.id },
            include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        });
        const permissions = new Set();
        for (const ur of userRoles)
            for (const rp of ur.role.rolePermissions)
                permissions.add(rp.permission.code);
        return { user, permissions: [...permissions] };
    }
};
exports.AccountService = AccountService;
exports.AccountService = AccountService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AccountService);
//# sourceMappingURL=account.service.js.map