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
exports.PermissionGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_service_1 = require("../../prisma/prisma.service");
const permissions_decorator_1 = require("../decorators/permissions.decorator");
let PermissionGuard = class PermissionGuard {
    reflector;
    prisma;
    constructor(reflector, prisma) {
        this.reflector = reflector;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const required = this.reflector.getAllAndOverride(permissions_decorator_1.PERMISSION_KEY, [
            context.getHandler(), context.getClass(),
        ]);
        if (!required)
            return true;
        const user = context.switchToHttp().getRequest().user;
        if (!user)
            throw new common_1.ForbiddenException('未认证');
        if (user.isSuperAdmin)
            return true;
        const userRoles = await this.prisma.userRole.findMany({
            where: { userId: user.sub },
            include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        });
        const codes = new Set();
        for (const ur of userRoles)
            for (const rp of ur.role.rolePermissions)
                codes.add(rp.permission.code);
        if (!codes.has(required))
            throw new common_1.ForbiddenException(`缺少权限: ${required}`);
        return true;
    }
};
exports.PermissionGuard = PermissionGuard;
exports.PermissionGuard = PermissionGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, prisma_service_1.PrismaService])
], PermissionGuard);
//# sourceMappingURL=permission.guard.js.map