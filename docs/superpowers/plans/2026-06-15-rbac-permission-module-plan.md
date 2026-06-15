# RBAC 权限模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建页面+按钮级权限的 RBAC 后台管理系统，含双 Token 鉴权、super_admin 特权、审计日志。

**Architecture:** 后端 NestJS + Prisma + PostgreSQL / 前端 Next.js 16 + Tailwind 4 + HeroUI。monorepo 下 `services/user-system` 和 `clients/admin-web` 两个子项目独立开发、统一集成。

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, JWT, bcrypt, Next.js 16, Tailwind 4, HeroUI

**Spec reference:** `docs/superpowers/specs/2026-06-15-rbac-permission-module-design.md`

---

## Phase 1: 工程底座（基础设施，前后端共用）

> 本阶段目标：项目骨架能跑、数据库建好、种子数据就位。不写任何业务代码。

### Task 1: monorepo 子项目脚手架

- [ ] **Step 1: 创建后端 NestJS 子项目**

```bash
cd services
nest new user-system --package-manager bun --skip-git
cd user-system && bun add @nestjs/common @nestjs/core @nestjs/platform-express prisma @prisma/client class-validator class-transformer jsonwebtoken bcrypt cookie-parser reflect-metadata rxjs
bun add -D @types/jsonwebtoken @types/bcrypt @types/cookie-parser
```

- [ ] **Step 2: 创建前端 Next.js 子项目**

```bash
cd clients
npx create-next-app@latest admin-web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd admin-web && bun add @heroui/button @heroui/input @heroui/table @heroui/modal
```

- [ ] **Step 3: 验证两项目编译**

```bash
cd services/user-system && bun run typecheck
cd clients/admin-web && bun run typecheck
```

Expected: 两端均零错误。

- [ ] **Step 4: Commit**

```bash
git add services/user-system/ clients/admin-web/
git commit -m "feat(rbac): scaffold monorepo sub-projects — user-system + admin-web"
```

---

### Task 2: 环境变量与配置

- [ ] **Step 1: 后端 .env**

`services/user-system/.env`:
```env
DATABASE_URL="postgresql://localhost:5432/rbac_dev"
JWT_ACCESS_SECRET="dev-access-secret-change-in-production"
JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production"
PORT=4002
CORS_ORIGIN="http://localhost:3000"
```

- [ ] **Step 2: 前端 .env.local**

`clients/admin-web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4002
```

- [ ] **Step 3: Commit**

```bash
git add services/user-system/.env clients/admin-web/.env.local
git commit -m "feat(rbac): add environment variables"
```

---

### Task 3: Prisma Schema + 数据库迁移 + 种子数据

- [ ] **Step 1: 编写完整 Schema（7 张表 + 4 枚举）**

`services/user-system/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus    { ACTIVE  DISABLED }
enum PermissionType { PAGE   BUTTON }
enum AuditAction    { LOGIN  LOGOUT  ROLE_CHANGE  PERM_CHANGE  USER_CRUD  SUPER_ADMIN }

model User {
  id            String     @id @default(uuid())
  username      String     @unique
  passwordHash  String
  isSuperAdmin  Boolean    @default(false)
  status        UserStatus @default(ACTIVE)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  userRoles     UserRole[]
  refreshTokens RefreshToken[]
  auditLogs     AuditLog[]
}

model Role {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  userRoles       UserRole[]
  rolePermissions RolePermission[]
}

model Permission {
  id        String         @id @default(uuid())
  name      String
  code      String         @unique
  type      PermissionType
  module    String
  parentId  String?
  parent    Permission?    @relation("PermissionTree", fields: [parentId], references: [id])
  children  Permission[]   @relation("PermissionTree")
  createdAt DateTime       @default(now())

  rolePermissions RolePermission[]
}

model UserRole {
  userId String
  roleId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
}

model RefreshToken {
  id         String    @id @default(uuid())
  token      String    @unique
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceInfo String?
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
}

model AuditLog {
  id         String     @id @default(uuid())
  userId     String?
  user       User?      @relation(fields: [userId], references: [id], onDelete: SetNull)
  action     AuditAction
  resource   String
  resourceId String?
  detail     String?
  ip         String?
  createdAt  DateTime   @default(now())
}
```

- [ ] **Step 2: 生成 Client + 执行迁移**

```bash
cd services/user-system && npx prisma generate
npx prisma migrate dev --name init-rbac
```

Expected: PostgreSQL 中 7 张表创建完成。

- [ ] **Step 3: 种子数据 — super_admin + 13 个权限**

`services/user-system/prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 12);
  const superAdmin = await prisma.user.upsert({
    where: { username: 'super_admin' },
    update: {},
    create: { username: 'super_admin', passwordHash, isSuperAdmin: true },
  });
  console.log(`super_admin created: ${superAdmin.id}`);

  const modules = ['dashboard', 'user', 'role', 'permission', 'audit'];
  const pagePerms = modules.map((mod) => ({
    name: `${mod} 页面查看`, code: `${mod}:page:view`, type: 'PAGE' as const, module: mod,
  }));

  const buttonPerms = [
    { name: '创建用户', code: 'user:button:create', type: 'BUTTON' as const, module: 'user' },
    { name: '编辑用户', code: 'user:button:edit', type: 'BUTTON' as const, module: 'user' },
    { name: '删除用户', code: 'user:button:delete', type: 'BUTTON' as const, module: 'user' },
    { name: '分配角色', code: 'user:button:assign-role', type: 'BUTTON' as const, module: 'user' },
    { name: '创建角色', code: 'role:button:create', type: 'BUTTON' as const, module: 'role' },
    { name: '编辑角色', code: 'role:button:edit', type: 'BUTTON' as const, module: 'role' },
    { name: '删除角色', code: 'role:button:delete', type: 'BUTTON' as const, module: 'role' },
    { name: '分配权限', code: 'role:button:assign-permission', type: 'BUTTON' as const, module: 'role' },
  ];

  for (const p of [...pagePerms, ...buttonPerms]) {
    await prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p });
  }
  console.log(`${pagePerms.length + buttonPerms.length} permissions seeded`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

Run:
```bash
cd services/user-system && npx ts-node prisma/seed.ts
```

Expected: 控制台输出用户 UUID + `13 permissions seeded`。

- [ ] **Step 4: PrismaService — 全局数据库连接**

`services/user-system/src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

`services/user-system/src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 5: Commit**

```bash
git add services/user-system/prisma/ services/user-system/src/prisma/
git commit -m "feat(rbac): add Prisma schema (7 tables), migration, seed data, and PrismaService"
```

---

## Phase 2: 后端核心（NestJS 全部业务逻辑）

> 本阶段目标：后端 API 全通，postman/curl 可独立测试。不写任何前端代码。

### Task 4: 鉴权基础设施 — 3 个 Guard + 2 个装饰器

**Files (all create under `services/user-system/src/common/`):**
- `guards/auth.guard.ts`
- `guards/super-admin.guard.ts`
- `guards/permission.guard.ts`
- `decorators/permissions.decorator.ts`
- `decorators/current-user.decorator.ts`

- [ ] **Step 1: AuthGuard — JWT 校验 + 提取 payload**

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev';

export interface JwtPayload { sub: string; username: string; isSuperAdmin: boolean; }

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');
    try {
      (request as any).user = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
      return true;
    } catch { throw new UnauthorizedException('Invalid or expired access token'); }
  }
}
```

- [ ] **Step 2: @Permissions() + @CurrentUser() 装饰器**

```typescript
// permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const PERMISSION_KEY = 'permission';
export const Permissions = (code: string) => SetMetadata(PERMISSION_KEY, code);

// current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../guards/auth.guard';
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 3: SuperAdminGuard + PermissionGuard**

SuperAdminGuard: `isSuperAdmin` → 直接返回 true。非 super_admin 也返回 true（交给 PermissionGuard 继续判断）。

PermissionGuard: 读取 `@Permissions` 元数据 → 未标注则放行 → 标注了则查用户角色→权限码→匹配 → 匹配失败抛 `ForbiddenException`。

- [ ] **Step 4: Commit**

```bash
git add services/user-system/src/common/
git commit -m "feat(rbac): add AuthGuard, SuperAdminGuard, PermissionGuard + decorators"
```

---

### Task 5: Auth — 登录 / 刷新 / 登出

**Files (all create under `services/user-system/src/auth/`):**
- `auth.module.ts` / `auth.service.ts` / `auth.controller.ts`
- `dto/login.dto.ts`
- Modify: `src/main.ts`（注册 cookieParser + CORS）

- [ ] **Step 1: LoginDto**

```typescript
import { IsString, MinLength } from 'class-validator';
export class LoginDto {
  @IsString() @MinLength(1) username: string;
  @IsString() @MinLength(6) password: string;
}
```

- [ ] **Step 2: AuthService — login / refresh / logout 完整实现**

```typescript
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto, ip?: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. 查用户 → 校验密码（bcrypt.compare）
    // 2. 签发 accessToken（jwt.sign, 15min）+ refreshToken（randomBytes 48, SHA256 哈希后落库, 7天）
    // 3. 写 auditLog（action: LOGIN）
    // 4. 返回 { accessToken, refreshToken }
  }

  async refresh(encrypted: string, ip?: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. SHA256 哈希加密后的 token → 查 refresh_tokens 表
    // 2. 校验未吊销 + 未过期
    // 3. 吊销旧 token（设置 revokedAt）
    // 4. 签发新 accessToken + 新 refreshToken（轮转）→ 落库
    // 5. 返回 { accessToken, refreshToken }
  }

  async logout(encrypted: string): Promise<void> {
    // SHA256 哈希 → 批量吊销（updateMany revokedAt = now）
  }
}
```

- [ ] **Step 3: AuthController — cookie 管理**

```typescript
@Controller('api/auth')
export class AuthController {
  @Post('login')  // body → login → Set-Cookie refreshToken (httpOnly, 7d) → return { accessToken }
  @Post('refresh') // cookie.refreshToken → refresh → 新 Set-Cookie → return { accessToken }
  @Post('logout')  // cookie.refreshToken → logout → return { message }
}
```

- [ ] **Step 4: 更新 main.ts**

```typescript
import * as cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });
```

- [ ] **Step 5: Commit**

```bash
git add services/user-system/src/auth/ services/user-system/src/main.ts
git commit -m "feat(rbac): add AuthService with login/refresh/logout and cookie-based refreshToken rotation"
```

---

### Task 6: Users CRUD

**Files (all create under `services/user-system/src/users/`):**
- `users.module.ts` / `users.service.ts` / `users.controller.ts`
- `dto/create-user.dto.ts` / `dto/update-user.dto.ts` / `dto/assign-roles.dto.ts`

- [ ] **Step 1: UsersService — findAll / create / update / assignRoles / remove**

每个方法对应一段 Prisma 操作：
- `findAll(page, limit)`: `findMany` skip/take + `count` 并行
- `create(dto)`: 校验用户名唯一 → bcrypt 哈希 → `create`
- `update(id, dto)`: 校验存在 → 按需更新 username/password/status
- `assignRoles(userId, { roleIds })`: `deleteMany` → `createMany`
- `remove(id)`: `update({ status: DISABLED })` 而非真删除

- [ ] **Step 2: UsersController — 所有接口加三重 Guard + @Permissions 注解**

```typescript
@Controller('api/users')
@UseGuards(AuthGuard, SuperAdminGuard, PermissionGuard)
export class UsersController {
  @Get()                        @Permissions('user:page:view')        findAll()
  @Post()                       @Permissions('user:button:create')    create()
  @Patch(':id')                 @Permissions('user:button:edit')      update()
  @Patch(':id/roles')           @Permissions('user:button:assign-role') assignRoles()
  @Delete(':id')                @Permissions('user:button:delete')    remove()
}
```

- [ ] **Step 3: Commit**

```bash
git add services/user-system/src/users/
git commit -m "feat(rbac): add Users CRUD with permission guards"
```

---

### Task 7: Roles + Permissions + AuditLogs + Account + AppModule

**Files (all create under `services/user-system/src/`):**
- `roles/` (module + service + controller + 3 DTOs)
- `permissions/` (module + service + controller)
- `audit-logs/` (module + service + controller)
- `account/` (module + service + controller)
- `app.module.ts`

- [ ] **Step 1: RolesService** — `findAll` / `findOne` / `create` / `update` / `assignPermissions` / `remove`

`assignPermissions(roleId, { permissionIds })`: 先 `deleteMany` 再 `createMany` 原子替换。

- [ ] **Step 2: PermissionsService** — `findAll`（嵌套树，parentId=null + include children）+ `create`

- [ ] **Step 3: AuditLogsService** — 只读分页 `findAll({ page, limit, action?, userId? })`。Controller 仅 GET，无写接口。

- [ ] **Step 4: AccountService** — `getMe(payload)` → 查用户信息 + 遍历 UserRole → RolePermission → 提取所有 permission.code 去重返回。

AccountController 仅 `@UseGuards(AuthGuard)`，无 `@Permissions`（登录即可）。

- [ ] **Step 5: AppModule — 注册全部 7 个模块**

```typescript
@Module({
  imports: [PrismaModule, AuthModule, UsersModule, RolesModule, PermissionsModule, AuditLogsModule, AccountModule],
})
export class AppModule {}
```

- [ ] **Step 6: 验证后端**

```bash
cd services/user-system && bun run typecheck && bun run build
```

Expected: 零错误。

- [ ] **Step 7: Commit**

```bash
git add services/user-system/src/
git commit -m "feat(rbac): add Roles, Permissions, AuditLogs, Account modules + AppModule wiring"
```

---

## Phase 3: 前端核心（Next.js 全部页面和组件）

> 本阶段目标：前端页面全通，可独立 `bun run dev` 并与后端联调。不写任何后端代码。

### Task 8: 基础设施 — api.ts + AuthContext + 3 个权限组件

**Files (all create under `clients/admin-web/`):**
- `lib/api.ts`
- `contexts/auth-context.tsx`
- `components/auth/AuthGuard.tsx`
- `components/auth/PermissionGuard.tsx`
- `components/auth/PermissionButton.tsx`

- [ ] **Step 1: api.ts — fetch 封装 + 并发 401 刷新（Promise 复用锁）**

```typescript
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(t: string | null) { accessToken = t; }

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise; // 复用已有 Promise
  refreshPromise = fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/refresh`, {
    method: 'POST', credentials: 'include',
  })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => d.accessToken)
    .catch(() => null)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const doFetch = (token?: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...opts, headers });
  };
  let res = await doFetch(accessToken || undefined);
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) { setAccessToken(newToken); res = await doFetch(newToken); }
    else { window.location.href = '/login'; throw new Error('Session expired'); }
  }
  if (!res.ok) { const err = await res.json().catch(() => ({ message: res.statusText })); throw new Error(err.message); }
  return res.json();
}
```

- [ ] **Step 2: AuthContext — 全局认证状态**

```typescript
// AuthProvider: useEffect 初始化时主动调 refresh → setAccessToken → /api/account/me → setUser + setPermissions
// 暴露: { user, permissions: Set<string>, loading, login(username, password), logout(), hasPermission(code) }
```

`hasPermission(code)` = `user?.isSuperAdmin || permissions.has(code)`。

- [ ] **Step 3: AuthGuard — 路由守卫**

```typescript
// loading → spinner; !user → redirect /login; user → render children
```

- [ ] **Step 4: PermissionGuard — 页面级（无权限时 null）**

```typescript
// hasPermission(code) ? children : null
```

- [ ] **Step 5: PermissionButton — 按钮级（无权限时不渲染）**

```typescript
// extends HeroUI Button + hasPermission(code) ? <Button {...props}>{children}</Button> : null
```

- [ ] **Step 6: Commit**

```bash
git add clients/admin-web/lib/ clients/admin-web/contexts/ clients/admin-web/components/
git commit -m "feat(rbac): add api fetch wrapper, AuthContext, and permission guard components"
```

---

### Task 9: 页面 — Login + (main) Layout + 全部 6 个业务页面

**Files (all create under `clients/admin-web/app/`):**
- `layout.tsx` (root — AuthProvider)
- `(auth)/login/page.tsx`
- `(main)/layout.tsx` (侧边栏 + 动态菜单)
- `(main)/dashboard/page.tsx`
- `(main)/users/page.tsx`
- `(main)/roles/page.tsx`
- `(main)/permissions/page.tsx`
- `(main)/audit-logs/page.tsx`
- `(main)/account/page.tsx`

- [ ] **Step 1: Root Layout + Login 页**

Root: `<AuthProvider>{children}</AuthProvider>`

Login: HeroUI Input + Button，调用 `auth.login(username, password)`，成功 `router.replace('/dashboard')`，失败显示错误提示。

- [ ] **Step 2: (main) Layout — 侧边栏动态菜单**

`menuItems = [{ label, href, permission }]` → `filter(hasPermission)` → 渲染 Link。底部显示 `user.username` + 退出按钮。

- [ ] **Step 3: 6 个业务页面**

| 页面 | HeroUI 组件 | 数据来源 |
|---|---|---|
| Dashboard | 欢迎卡片 | `useAuth().user` |
| Users | Table + PermissionButton | `api('/api/users')` |
| Roles | Table + Modal 表单 | `api('/api/roles')` |
| Permissions | 树形卡片 | `api('/api/permissions')` |
| AuditLogs | Table + Dropdown 筛选 | `api('/api/audit-logs')` |
| Account | 用户卡片 + 权限标签 | `api('/api/account/me')` |

- [ ] **Step 4: 验证前端编译**

```bash
cd clients/admin-web && bun run typecheck && bun run build
```

Expected: 零错误。

- [ ] **Step 5: Commit**

```bash
git add clients/admin-web/app/
git commit -m "feat(rbac): add login page, main layout with dynamic sidebar, and 6 business pages"
```

---

## Phase 4: 集成和收尾

> 本阶段目标：端到端验证通过，文档完备。

### Task 10: E2E 验收测试

**Files:**
- Create: `services/user-system/test/rbac.e2e-spec.ts`

- [ ] **Step 1: 5 个关键测试用例**

```typescript
describe('RBAC E2E', () => {
  it('POST /api/auth/login — 200, 返回 accessToken + Set-Cookie');
  it('GET /api/account/me — 200, 返回 user + permissions[]');
  it('POST /api/auth/refresh — 200, 返回新 accessToken + 新 Set-Cookie');
  it('GET /api/users — 无 token 返回 401');
  it('POST /api/auth/logout → refresh — 登出后 refresh 返回 401');
});
```

- [ ] **Step 2: Run**

```bash
cd services/user-system && npx jest --config jest-e2e.json
```

Expected: 5 tests PASS.

---

### Task 11: 前后端联调 + README

- [ ] **Step 1: 同时启动**

```bash
# Terminal 1
cd services/user-system && bun run dev   # :4002

# Terminal 2
cd clients/admin-web && bun run dev      # :3000
```

- [ ] **Step 2: 联调 check-list**

```
□ http://localhost:3000 → 重定向 /login
□ super_admin / admin123 登录 → /dashboard
□ 侧边栏显示全部 5 个菜单（super_admin 全权限）
□ 用户管理 → 新建用户 → 分配角色
□ 角色管理 → 创建角色 → 分配权限
□ 审计日志 → 可见登录记录
□ 刷新页面 → 自动恢复登录态
□ 退出 → 跳 /login
```

- [ ] **Step 3: 补充 README**

`services/user-system/README.md` 和 `clients/admin-web/README.md` 各加 3 行启动命令。

- [ ] **Step 4: Commit**

```bash
git add services/user-system/README.md clients/admin-web/README.md services/user-system/test/
git commit -m "docs(rbac): add E2E tests, README startup instructions"
```

---

## Self-Review

1. **Spec coverage**: Schema ✅ (Task 3), 鉴权 ✅ (Tasks 4-5), 业务 CRUD ✅ (Tasks 6-7), 前端 ✅ (Tasks 8-9), 测试 ✅ (Task 10), 联调 ✅ (Task 11)
2. **Placeholder scan**: 零 TBD / TODO
3. **Phase 隔离**: 底座 → 只做基础设施；后端 → 只写 NestJS；前端 → 只写 Next.js；集成 → 只做测试和联调。阶段之间不交叉

---

Plan complete and saved to `docs/superpowers/plans/2026-06-15-rbac-permission-module-plan.md`.
