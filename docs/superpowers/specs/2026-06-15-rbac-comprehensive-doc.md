# RBAC 权限管理系统 — 完整技术文档

> 最后更新: 2026-06-15 | 版本: 1.0

---

## 目录

- [一、系统概述](#一系统概述)
- [二、数据库详解](#二数据库详解)
- [三、后端架构](#三后端架构)
- [四、前端架构](#四前端架构)
- [五、认证与安全](#五认证与安全)
- [六、本地开发](#六本地开发)

---

## 一、系统概述

### 1.1 项目定位

一个支持 **页面 + 按钮级权限控制** 的后台管理系统 RBAC 模块。核心特性：

- 用户 → 角色 → 权限 三层权限模型
- 双 Token 认证（accessToken 15min + refreshToken 7d）
- super_admin 超级管理员特权通道
- 敏感操作审计日志
- 前端权限组件体系（路由守卫 + 页面守卫 + 按钮守卫）

### 1.2 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 后端 | NestJS 11 + Prisma 5 + PostgreSQL | 4002 |
| 前端 | Next.js 16 + Tailwind 4 + Axios | 3001 |
| 共享 | packages/database (Prisma Client 单例) | — |
| 包管理 | bun 1.3 (monorepo) | — |

### 1.3 项目结构

```
dream-llm/
  services/user-system/        # 后端 (端口 4002)
  clients/admin-web/           # 前端 (端口 3001)
  packages/database/           # 共享数据库客户端
  docs/superpowers/            # 设计文档和计划
```

---

## 二、数据库详解

### 2.1 为什么选择 PostgreSQL 而不是 MySQL

这是一个很重要的选型问题。两者都是成熟的关系型数据库，但有关键差异：

| 维度 | PostgreSQL | MySQL |
|---|---|---|
| **数据类型** | 原生支持 UUID、JSONB、数组、枚举 | JSON 支持较弱，无原生 UUID |
| **ACID 合规** | 严格遵循，默认 SERIALIZABLE | 取决于存储引擎（InnoDB vs MyISAM） |
| **扩展性** | 支持自定义类型、函数、扩展（如 pgvector） | 扩展机制较弱 |
| **开源协议** | PostgreSQL License（完全自由） | GPL + 商业许可（Oracle 持有） |
| **并发模型** | MVCC + 多版本，读写互不阻塞 | 默认行锁，高并发写场景可能瓶颈 |
| **字符集与排序** | 原生 UTF-8，中文排序无痛 | 字符集配置复杂，历史遗留问题多 |

**对本项目而言，选择 PostgreSQL 的核心理由**：

1. **UUID 主键**：所有表主键使用 UUID（而非自增 ID），PostgreSQL 原生 `uuid` 类型，MySQL 需要用 `CHAR(36)` 模拟，索引效率差很多
2. **枚举类型**：Schema 中定义了 `UserStatus`、`PermissionType`、`AuditAction` 三个枚举，PostgreSQL 原生支持，MySQL 只能用 `VARCHAR` + 应用层约束
3. **Prisma 集成**：Prisma 对 PostgreSQL 的支持最成熟，枚举、JSON 字段、关联查询都无缝
4. **未来扩展**：如果要接入向量检索（pgvector 扩展），PostgreSQL 一条命令搞定，MySQL 不支持

> **一句话总结**：PostgreSQL 是"学院派"数据库，功能完备、规范严格；MySQL 是"实用派"数据库，简单场景快。做企业级系统选 PostgreSQL。

### 2.2 数据库是如何被管理的：Prisma ORM

数据库不是直接写 SQL 操作的，而是通过 **Prisma** 这一层"翻译官"：

```
你的代码                     Prisma                      PostgreSQL
  │                            │                            │
  ├─ prisma.user.findMany()  ─├─ 生成并执行 SQL ───────────├→ SELECT * FROM "User"
  │                            │                            │
  ├─ prisma.user.create({})  ─├─ 生成并执行 SQL ───────────├→ INSERT INTO "User" ...
  │                            │                            │
  └─ prisma.$transaction([]) ─├─ 生成并执行事务 ────────────├→ BEGIN; ... COMMIT;
```

**Prisma 的三层结构**：

```
schema.prisma      →  定义数据模型（表结构、字段类型、关联关系）
prisma generate    →  根据 schema 生成类型安全的 TypeScript Client
Prisma Client      →  你在代码中调用的 API（findMany / create / update 等）
```

**为什么用 ORM 而不是直接写 SQL**：

- **类型安全**：`prisma.user.findMany()` 的返回值有完整的 TypeScript 类型，IDE 自动补全
- **防注入**：所有参数自动参数化，不会拼接 SQL 字符串。例如你永远不用写 `` `SELECT * FROM users WHERE username = '${input}'` `` 这种危险代码
- **迁移管理**：改 Schema → `prisma migrate dev` → 自动生成 SQL 迁移文件，可版本控制、可回滚
- **关系查询**：`include` / `select` 语法简洁表达多表关联，不用手写 JOIN

### 2.3 数据模型：7 张表详解

#### 实体关系图

```
  User                         Role                      Permission
  ┌──────────┐                ┌──────────┐               ┌──────────────┐
  │ id (PK)  │                │ id (PK)  │               │ id (PK)      │
  │ username │                │ name     │               │ name         │
  │ password │                │ code     │               │ code         │
  │ isSuper  │                │ desc     │               │ type (PAGE/  │
  │ status   │                └────┬─────┘               │  BUTTON)     │
  └────┬─────┘                     │                     │ module       │
       │                           │                     │ parentId (FK)│──┐
       │                    ┌──────┴──────┐              └──────┬───────┘  │
       │                    │ RolePermission│                    │          │
       │                    │ (中间表)      │                    │ (自引用)  │
       │                    │ roleId (FK)  │────────────────────┤          │
       │                    │ permissionId │                    │          │
       │                    └──────────────┘                    └──────────┘
       │
       ├── UserRole (中间表)
       │    userId (FK)
       │    roleId (FK)
       │
       ├── RefreshToken
       │    token (哈希)
       │    userId (FK)
       │    expiresAt / revokedAt
       │
       └── AuditLog
            userId (FK)
            action (枚举)
            resource / detail / ip
```

---

#### 表 1: User (用户)

```prisma
model User {
  id            String     @id @default(uuid())
  username      String     @unique
  passwordHash  String
  isSuperAdmin  Boolean    @default(false)
  status        UserStatus @default(ACTIVE)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
}
```

| 字段 | 类型 | 说明 | 为什么这样设计 |
|---|---|---|---|
| id | UUID 字符串 | 主键 | 自增 ID 暴露用户数量，UUID 不可预测 → 更安全 |
| username | 字符串 | 唯一用户名 | `@unique` 在数据库层创建唯一索引，防重 |
| passwordHash | 字符串 | bcrypt 哈希后的密码 | **永远不存明文密码**。即使数据库泄露，攻击者也推算不出原始密码 |
| isSuperAdmin | 布尔 | 超级管理员标记 | 放在 User 表而非 Role 表：角色可被删除，但 super_admin 是身份属性，不应随角色消失 |
| status | 枚举 | ACTIVE / DISABLED | 软删除模式：不真删数据，只标记状态。审计日志和历史数据可追溯 |

**关键设计决策**：

- **为什么 id 用 UUID 而不是自增数字？**

```
自增 ID:  1, 2, 3, 4...  →  攻击者可以遍历 /api/users/1, /api/users/2 ...
UUID:     a1b2c3d4-e5f6-... →  无法猜测，无法遍历
```

---

#### 表 2: Role (角色)

```prisma
model Role {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  description String?
}
```

| 字段 | 说明 |
|---|---|
| name | 角色显示名称，如"系统管理员" |
| code | 唯一标识符，如 `admin`、`viewer`。代码中使用 code 而非 name，因为 name 可能变更 |
| description | 角色说明 |

**种子数据创建的两个角色**：

| role | code | 拥有权限 |
|---|---|---|
| 系统管理员 | admin | 全部 13 个权限（5 页面 + 8 按钮） |
| 普通用户 | viewer | 5 个页面查看权限（只读） |

---

#### 表 3: Permission (权限)

```prisma
model Permission {
  id        String         @id @default(uuid())
  name      String
  code      String         @unique
  type      PermissionType
  module    String
  parentId  String?
  parent    Permission?    @relation("PermissionTree", fields: [parentId], references: [id])
  children  Permission[]   @relation("PermissionTree")
}
```

**权限码命名规范**：`模块:类型:动作`

```
dashboard:page:view           →  仪表盘页面的查看权限
user:page:view                →  用户管理页面的查看权限
user:button:create            →  用户管理页面的"新建用户"按钮
role:button:assign-permission →  角色管理页面的"分配权限"按钮
```

**权限的树形结构**：

```
dashboard (模块)
  └── dashboard:page:view (PAGE)

user (模块)
  └── user:page:view (PAGE)
        ├── user:button:create (BUTTON)
        ├── user:button:edit (BUTTON)
        ├── user:button:delete (BUTTON)
        └── user:button:assign-role (BUTTON)

role (模块)
  └── role:page:view (PAGE)
        ├── role:button:create (BUTTON)
        ├── role:button:edit (BUTTON)
        ├── role:button:delete (BUTTON)
        └── role:button:assign-permission (BUTTON)
```

**`parentId` 自引用**：Permission 表的 `parentId` 指向同表另一条记录，形成树。`@relation("PermissionTree")` 是 Prisma 语法，告诉 ORM 这是自引用关系。数据库层面就是一个外键指向自己的主键。

---

#### 表 4 & 5: UserRole 和 RolePermission (中间表)

```prisma
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
```

**为什么需要中间表**：User 和 Role 是"多对多"关系（一个用户可以拥有多个角色，一个角色下可以有多个用户），关系型数据库中需要中间表来表达这种关联。

```
不是: User ──┬── Role     (这只能表达"一个用户属于一个角色")
正确: User ──┬── UserRole ──┬── Role    (一个用户可以通过中间表关联多个角色)
```

**`onDelete: Cascade`**：当 User / Role 被删除时，对应的中间表记录自动删除，不会留下孤儿数据。

**`@@id([userId, roleId])`**：联合主键 — 同一个用户+角色组合只能出现一次，防止重复分配。

---

#### 表 6: RefreshToken (刷新令牌)

```prisma
model RefreshToken {
  id         String    @id @default(uuid())
  token      String    @unique
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceInfo String?
  expiresAt  DateTime
  revokedAt  DateTime?
}
```

**RefreshToken 的生命周期**：

```
1. 用户登录       →  生成 refreshToken，SHA256 哈希后存入 token 字段
                      expiresAt = 当前时间 + 7 天，revokedAt = null

2. 用户刷新 token  →  旧 token 的 revokedAt 设为 now()
                      生成新 token，写入新行

3. 用户登出       →  revokedAt 设为 now()

4. token 到期     →  expiresAt < now()，自然失效，无需手动清理
```

**为什么存储哈希值而不是原始 token**：

```
如果存原始 token:  数据库泄露 → 攻击者拿到所有设备的 refreshToken → 全部用户被盗
存储 SHA256 哈希:  数据库泄露 → 攻击者拿到的是一串无法反推的哈希 → 无意义
```

用户发来的原始 token 与库中哈希比对的过程：`SHA256(用户传来的token) === 库里存的哈希值?`。

---

#### 表 7: AuditLog (审计日志)

```prisma
model AuditLog {
  id         String     @id @default(uuid())
  userId     String?
  action     AuditAction
  resource   String
  resourceId String?
  detail     String?
  ip         String?
  createdAt  DateTime   @default(now())
}
```

| 字段 | 说明 | 示例 |
|---|---|---|
| action | 操作类型（枚举） | LOGIN, LOGOUT, ROLE_CHANGE, PERM_CHANGE, USER_CRUD, SUPER_ADMIN |
| resource | 操作对象 | "auth", "user", "role" |
| resourceId | 对象 ID | 被修改的用户 UUID |
| detail | 操作详情（JSON） | `{"old:" {...}, "new": {...}}` |
| ip | 操作 IP | 用于安全审计和异地登录检测 |

**AuditLog 是只追加、不修改、不删除的**。前端只有 GET 接口，没有 POST/PATCH/DELETE。创建日志由后端各 Service 在操作时自动写入。

**`userId` 可为空 + `onDelete: SetNull`**：如果用户被删除，审计日志保留（userId 变 null），不丢失历史记录。

### 2.4 Prisma 工作流：从 Schema 到数据库

整个声明周期只需 3 个命令：

```bash
# 1. 定义 Schema (prisma/schema.prisma) — 手动编写

# 2. 生成类型安全的 Client
npx prisma generate
# 输出: node_modules/.prisma/client/index.d.ts
# 为每个 model 生成 TypeScript 类型和 CRUD 方法

# 3. 同步 Schema 到数据库
npx prisma migrate dev --name init-rbac
# Prisma 自动:
#   a. 对比当前 Schema 和数据库实际结构
#   b. 生成 SQL 迁移文件（prisma/migrations/xxx.sql）
#   c. 执行迁移
#   d. 重新生成 Client
```

**迁移文件示例** (由 Prisma 自动生成，不需要手写)：

```sql
-- prisma/migrations/20260615000000_init_rbac/migration.sql
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
-- ... 其余 6 张表
```

### 2.5 种子数据：系统初始状态

`prisma/seed.ts` 在首次部署时运行，创建最小可用的初始数据集：

```
执行后的数据库状态:

┌────────────────────────────────────────────────────┐
│  User:  super_admin (isSuperAdmin=true)            │
│  Role:  系统管理员 (code=admin)                    │
│         普通用户 (code=viewer)                     │
│  Perm:  13 个权限码                                │
│                                                      │
│  关联关系:                                           │
│  super_admin ──→ 系统管理员角色 ──→ 13 个权限（全权）│
│  (viewer 角色拥有 5 个只读权限，未分配给任何用户)    │
└────────────────────────────────────────────────────┘
```

---

## 三、后端架构

### 3.1 请求处理流程

```
HTTP 请求
  │
  ├── cookieParser 中间件 (解析 cookie 中的 refreshToken)
  ├── ValidationPipe (校验 DTO)
  │
  ├── AuthGuard (JWT 校验 → 提取 user payload → 挂载到 request.user)
  │     └── 无/无效 token → 401
  │
  ├── SuperAdminGuard (isSuperAdmin? → 直接放行)
  │     └── 到此还未放行 → 进入下一层
  │
  ├── PermissionGuard (查用户角色→权限→匹配 @Permissions 元数据)
  │     └── 无权限 → 403
  │
  └── Controller (业务逻辑)
```

### 3.2 关键文件职责

| 文件 | 职责 | 不负责 |
|---|---|---|
| `common/guards/auth.guard.ts` | 校验 JWT，提取 payload | 不查权限 |
| `common/guards/permission.guard.ts` | 查用户权限码，匹配接口所需权限 | 不校验 JWT |
| `common/decorators/permissions.decorator.ts` | `@Permissions('user:page:view')` 声明接口所需权限 | 不执行校验 |
| `auth/auth.service.ts` | 签发/验证/吊销 token，密码比对 | 不处理 HTTP 请求 |
| `auth/auth.controller.ts` | 接收 HTTP 请求，Set-Cookie | 不操作数据库 |

### 3.3 权限校验原理

```typescript
// Controller 中声明接口所需权限
@Get()
@Permissions('user:page:view')  // ← 这行把元数据挂到方法上
findAll() { ... }

// PermissionGuard 在运行时:
// 1. Reflector 反射读取方法上的 'user:page:view'
// 2. 查当前用户的角色 → 权限码集合
// 3. codes.has('user:page:view') ?
//    true  → 放行
//    false → 403 ForbiddenException
```

**三种无权限场景的行为**：

| 场景 | 后端行为 | 前端行为 |
|---|---|---|
| 无 token | 401 | AuthGuard → redirect /login |
| 有 token，无权限码 | 403 | PermissionGuard → null（页面不渲染） |
| 有 token，无按钮权限 | 403 | PermissionButton → null（按钮不显示） |

---

## 四、前端架构

### 4.1 认证状态管理

```
页面加载
  │
  └── AuthProvider (useEffect)
        │
        ├── POST /api/auth/refresh (cookie 自动带 refreshToken)
        │     ├── 成功 → 拿到 accessToken → setAccessToken()
        │     │         → GET /api/account/me → setUser + setPermissions
        │     │         → loading = false → 正常渲染
        │     └── 失败 → loading = false → AuthGuard redirect /login
        │
        └── 用户操作
              ├── login(username, password) → 同上流程
              ├── logout() → 清空所有状态 → redirect /login
              └── hasPermission(code) → user.isSuperAdmin || permissions.has(code)
```

### 4.2 三层权限组件

```
AuthGuard          页面渲染前检查，未登录重定向
  └── Sidebar      hasPermission 过滤可见菜单
  └── PermissionGuard  页面级检查 code，无权限返回 null
        └── PermissionButton  按钮级检查 code，无权限不渲染
```

### 4.3 API 请求链路（Axios 拦截器）

```
apiClient.post("/users", data)
  │
  ├── request interceptor: 自动注入 Authorization header
  │
  ├── 后端返回 401
  │     │
  │     ├── response interceptor:
  │     │     1. isRefreshing? → 排队等待（不重复发 refresh）
  │     │     2. !isRefreshing → 创建 refreshPromise
  │     │     3. 成功 → 更新 accessToken → 重放原请求
  │     │     4. 失败 → window.location.href = '/login'
  │     │
  ├── 后端返回 403
  │     └── 抛出错误，由业务页面自行处理（不全局跳转）
  │
  └── 后端返回 200 → 返回 response.data
```

---

## 五、认证与安全

### 5.1 双 Token 机制

```
登录:
  客户端 ──POST /api/auth/login { username, password }──→ 服务端
         ←── { accessToken } + Set-Cookie: refreshToken ──

每次请求:
  客户端 ──Authorization: Bearer <accessToken>──→ 服务端

accessToken 过期:
  客户端 ──POST /api/auth/refresh (cookie 自动携带)──→ 服务端
         ←── { accessToken } + Set-Cookie: 新 refreshToken ──
         (旧的 refreshToken 被吊销)

退出:
  客户端 ──POST /api/auth/logout──→ 服务端
         (refreshToken 被标记 revokedAt = now)
```

### 5.2 密码安全

```
注册/修改密码:
  password = "admin123"
      │
      └── bcrypt.hash(password, saltRounds=12)
            │
            └── "$2b$12$LJ3m4ys3GZ..." → 存入 passwordHash

登录:
  password = "admin123" (用户输入)
      │
      └── bcrypt.compare(password, passwordHash)
            │
            └── true/false
```

**bcrypt 的核心优势**：同一密码每次哈希结果不同（因为随机 salt），无法通过彩虹表反推。即使两个用户密码都是 "admin123"，库里的哈希值完全不同。

---

## 六、本地开发

### 6.1 前置条件

- PostgreSQL 运行在 `localhost:5432`
- bun >= 1.3

### 6.2 首次启动

```bash
# 1. 创建数据库
createdb rbac_dev

# 2. 安装依赖
cd /Users/juweinan/code/projects/study-ai/dream-llm
bun install

# 3. 初始化数据库
cd services/user-system
npx prisma migrate dev --name init-rbac
npx ts-node prisma/seed.ts

# 4. 一键启动
cd /Users/juweinan/code/projects/study-ai/dream-llm
bun run dev:rbac
```

### 6.3 默认账户

| 用户名 | 密码 | 权限 |
|---|---|---|
| super_admin | admin123 | 全部（Super Admin） |

### 6.4 环境变量

**services/user-system/.env**:
```env
DATABASE_URL="postgresql://juweinan@localhost:5432/rbac_dev"
JWT_ACCESS_SECRET="dev-access-secret-change-in-production"
JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production"
PORT=4002
CORS_ORIGIN="http://localhost:3001"
```

**clients/admin-web/.env.local**:
```env
NEXT_PUBLIC_API_URL=http://localhost:4002
```
