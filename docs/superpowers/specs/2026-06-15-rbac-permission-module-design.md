# RBAC 权限模块设计文档

> 状态：设计完成 | 日期：2026-06-15 | 下一步：writing-plans

## 边界决策

| 决策点 | 选择 | 要点 |
|---|---|---|
| 权限粒度 | **B — 页面 + 按钮** | 前端权限组件 + 后端接口校验，双重保障 |
| super_admin | **A — 需要** | 硬编码绕过，独立审计日志，仅 DB 直配，不可通过 UI 创建/提权 |
| refreshToken | **A — 落 PostgreSQL** | 独立表存储，支持可吊销、可追踪登录状态、可单设备强制下线 |
| 审计日志 | **B — 敏感操作** | 登录/登出 + 权限变更 + 角色修改 + super_admin 操作 + 用户 CRUD |
| 租户维度 | **A — 不需要** | 纯全局 RBAC，无组织/部门/租户数据隔离需求 |

## 架构选型

选择**方案三：经典 RBAC（3 实体表）+ 前端权限组件体系**。

理由：纯全局 RBAC，权限码数量可控，3 表模型简洁够用；在前端封装 AuthGuard / PermissionGuard / PermissionButton 组件提升复用性。

---

## 数据模型

核心 5 张表（3 实体 + 2 中间表），外加 RefreshToken 和 AuditLog：

```
User ──┬── UserRole ──┬── Role ──┬── RolePermission ──┬── Permission
       │  (N:M)       │          │  (N:M)             │
       └──────────────┘          └────────────────────┘
```

### User
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | PK |
| username | String | 唯一 |
| passwordHash | String | bcrypt, salt rounds = 12 |
| isSuperAdmin | Boolean | true 时跳过所有权限校验 |
| status | Enum | ACTIVE / DISABLED |
| createdAt / updatedAt | DateTime | — |

### Role
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | PK |
| name | String | 角色名称（如"部门管理员"） |
| code | String | 唯一标识（如 `dept_admin`） |
| description | String? | — |

### Permission
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | PK |
| name | String | — |
| code | String | 权限码，如 `user:page:view` |
| type | Enum | PAGE / BUTTON |
| parentId | UUID? | 自引用，构建页面→按钮父子关系 |
| module | String | 模块名，如 `user`、`role` |

### UserRole / RolePermission（中间表）
| 字段 | 类型 |
|---|---|
| userId / roleId | UUID, FK |
| roleId / permissionId | UUID, FK |

### RefreshToken
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | PK |
| token | String | 哈希后的 refreshToken |
| userId | UUID | FK → User |
| deviceInfo | String? | User-Agent / IP |
| expiresAt | DateTime | — |
| revokedAt | DateTime? | null = 有效 |
| createdAt | DateTime | — |

### AuditLog
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | PK |
| userId | UUID? | null = 匿名操作 |
| action | Enum | LOGIN / LOGOUT / ROLE_CHANGE / PERM_CHANGE / USER_CRUD / SUPER_ADMIN |
| resource | String | 操作对象类型，如 `role` |
| resourceId | String? | 操作对象 ID |
| detail | String? | JSON 格式的操作详情 |
| ip | String? | 请求 IP |
| createdAt | DateTime | — |

### 关键设计决策
- `isSuperAdmin` 放在 User 表而非 Role 表——防止角色被误删导致 super_admin 权限丢失
- Permission 自引用树形结构——前端渲染权限树天然友好
- RefreshToken 独立表而非 JSON 字段——方便查询和批量吊销

---

## 权限码约定

```
页面权限：  module:page:action    →  user:page:view, role:page:edit
按钮权限：  module:button:action  →  user:button:create, report:button:export
```

前端从 `GET /api/account/me` 获取权限码列表，存入 AuthContext，使用 Set 数据结构（O(1) 查找）。

---

## API 设计

### Auth
| 方法 | 路由 | 说明 |
|---|---|---|
| POST | /api/auth/login | 返回 accessToken（body）, refreshToken（Set-Cookie） |
| POST | /api/auth/refresh | 读取 cookie 中的 refreshToken，返回新 accessToken + 新 Set-Cookie |
| POST | /api/auth/logout | 吊销 refreshToken |
| GET | /api/auth/sessions | 当前用户所有登录设备 |

### Users
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/users | 用户列表（分页） |
| POST | /api/users | 创建用户 |
| PATCH | /api/users/:id | 编辑用户 |
| PATCH | /api/users/:id/roles | 分配角色 |
| DELETE | /api/users/:id | 禁用/删除 |

### Roles
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/roles | 角色列表 |
| POST | /api/roles | 创建角色 |
| PATCH | /api/roles/:id | 编辑角色 |
| PATCH | /api/roles/:id/permissions | 分配权限 |
| DELETE | /api/roles/:id | 删除角色 |

### Permissions
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/permissions | 权限树（按 module 嵌套） |
| POST | /api/permissions | 创建权限 |

### AuditLogs
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/audit-logs | 审计日志（分页 + 筛选） |

### Account
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/account/me | 当前用户信息 + 权限码列表 |

### 鉴权流程
```
请求 → AuthGuard (JWT校验)
     → SuperAdminGuard (isSuperAdmin → 直接放行)
     → PermissionGuard (查权限码 → 放行/403)
     → Controller
```

---

## 前端组件设计

### 组件树
```
Layout
├── AuthGuard (路由守卫，未登录 → /login)
│   └── Layout
│       ├── Sidebar (动态菜单，根据权限码过滤)
│       └── Main
│           └── PermissionButton (按钮守卫)
```

### 3 个核心组件
| 组件 | 作用 | 用法示例 |
|---|---|---|
| AuthGuard | 路由守卫，包裹所有需登录页面 | `<AuthGuard><DashboardPage /></AuthGuard>` |
| PermissionGuard | 页面级守卫 | `<PermissionGuard code="user:page:view"><UsersPage /></PermissionGuard>` |
| PermissionButton | 按钮级守卫，无权限时不渲染 | `<PermissionButton code="user:button:create">新建</PermissionButton>` |

### 权限数据流
```
GET /api/account/me → { user, permissions: [...] }
  → AuthContext (useReducer)
    → PermissionGuard / PermissionButton 查 Set.has()
      → 无权限 → return null（不渲染）
      → 有权限 → 正常渲染子组件
```

---

## 安全策略

### JWT 双 Token 机制
| | accessToken | refreshToken |
|---|---|---|
| 存储位置 | 前端内存（变量） | httpOnly cookie |
| 有效期 | 15 分钟 | 7 天 |
| 泄露后果 | 15 分钟后自动失效 | 可主动吊销 |
| XSS 防护 | 不在 localStorage，JS 无法读取 | httpOnly, JS 完全无法访问 |

### Token 刷新流程（解决并发 401 问题）

```
3 个请求同时返回 401
  │
  ├── 请求 1: refreshPromise = null? yes → 创建 Promise → 调 /api/auth/refresh
  ├── 请求 2: refreshPromise = null? no  → 复用同一个 Promise
  └── 请求 3: refreshPromise = null? no  → 复用同一个 Promise
              │
              └── 3 个请求 await 同一个 Promise —— 只发出 1 次 refresh 请求
                    │
                    ├── 成功 → 3 个请求拿到新 token 各自重放原请求
                    └── 失败 → 跳转 /login
```

**前端实现核心代码**：
```typescript
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;  // 复用已有 Promise

  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => data.accessToken)
    .catch(() => null)
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}
```

**请求拦截器中**：
```typescript
if (response.status === 401) {
  const newToken = await refreshAccessToken();
  if (newToken) {
    setAccessToken(newToken);
    response = await doFetch(newToken);  // 用新 token 重放原请求
  } else {
    window.location.href = '/login';
  }
}
```

**refreshToken 轮转**：
- 每次 refresh 成功后，后端同时更新 refreshToken：
  - 旧 refreshToken 标记 used / 删除
  - 签发新 refreshToken 写入 `refresh_tokens` 表
  - 通过 `Set-Cookie` 返回给浏览器
- 防止 refreshToken 泄露后被无限续期

**页面刷新与 Token 恢复**：

accessToken 存在前端内存（JS 变量），refreshToken 存在 `httpOnly cookie`（浏览器管理）。刷新页面时：

```
用户刷新页面（F5 / Cmd+R）
  │
  ├── JS 内存释放 → accessToken 丢失
  ├── cookie 存储区不动 → refreshToken 还在
  │
  ├── 页面重新加载 → AuthContext 初始化
  │     │
  │     └── 立刻调 POST /api/auth/refresh
  │           （cookie 自动携带 refreshToken，前端无需手动处理）
  │           │
  │           ├── 成功 → 拿到新 accessToken → 存内存 → 正常渲染
  │           └── 失败 → 跳转 /login
  │
  └── 用户无感知，整个过程约 200ms
```

也就是说**每次页面刷新都会走一次 refresh**，这是设计使然——用一次近乎无感的网络请求，换取"accessToken 泄露窗口仅 15 分钟"的安全收益。

**优化：页面加载时主动刷新，而非等 401**：

```typescript
// AuthContext 初始化时立刻刷新，而不是等某个业务请求报 401 再去刷新
useEffect(() => {
  const token = await refreshAccessToken();
  if (token) {
    setAccessToken(token);
    fetchUserInfo(token);  // 紧接着拉用户信息和权限
  } else {
    router.push('/login');
  }
}, []);
```

**清空浏览器缓存（清除 cookie）的后果**：

```
清空 cookie → refreshToken 丢失
  → /api/auth/refresh 请求头里没有 cookie → 后端 401
  → 跳转 /login → 用户重新输账号密码
```

这等同于"主动注销所有登录态"，重新登录是预期行为。单 token 方案清空 localStorage 也一样要重新登录——两种方案在这个场景下没有区别。

**为什么 refreshToken 存 httpOnly cookie 而非 localStorage**：

| 存储方式 | XSS 攻击（脚本注入） | JS 能否读取 |
|---|---|---|
| localStorage | 直接被偷 | 能 |
| httpOnly cookie | JS 完全无法访问 | 不能 |

即使页面被注入了恶意脚本，攻击者也拿不到 refreshToken。accessToken 虽然在内存中理论上可被读到，但它 15 分钟后就过期了，且每次 refresh 后 refreshToken 轮转，旧 token 立即失效。

### super_admin 安全约束
```
✅ 允许：跳过所有权限校验、查看所有数据、操作所有功能
❌ 禁止：
   - 通过 UI 创建/提权（只能 DB 直配）
   - 删除自己产生的审计日志
   - 修改其他 super_admin 的密码
```

### 接口安全
| 措施 | 实现 |
|---|---|
| 双重校验 | 前端隐藏按钮 + 后端 Guard，不能只靠前端 |
| 密码哈希 | bcrypt, salt rounds = 12 |
| 频率限制 | `/api/auth/login` 单 IP 每分钟最多 5 次 |
| 参数校验 | DTO + class-validator，白名单模式 |

---

## 测试策略

| 层级 | 工具 | 覆盖内容 |
|---|---|---|
| 单元测试 | Jest | Prisma CRUD、Guard 逻辑、refreshToken 吊销 |
| E2E | Supertest | 登录流程、403 场景、权限分配→生效链路 |
| 前端 | 后续再定 | PermissionGuard / PermissionButton 渲染逻辑 |

### 核心测试用例
- 普通用户访问无权限页面 → 403
- super_admin 访问任意页面 → 200
- refreshToken 吊销后 → `/api/auth/refresh` 返回 401
- 分配角色后 → 权限立即生效（不依赖重新登录）
- 同一用户多地登录 → 各设备 refreshToken 独立，单设备可吊销

---

## 文件结构

```
services/user-system/            # 后端 NestJS
  src/
    auth/                       # 登录/登出/刷新
    users/                      # 用户管理
    roles/                      # 角色管理
    permissions/                # 权限管理
    audit-logs/                 # 审计日志
    common/
      guards/                   # AuthGuard, SuperAdminGuard, PermissionGuard
      decorators/               # @Permissions('user:page:view')
    prisma/                     # PrismaService, schema.prisma
    main.ts

clients/admin-web/              # 前端 Next.js
  app/
    (auth)/login/
    (main)/
      dashboard/
      users/
      roles/
      permissions/
      audit-logs/
      account/
  components/
    auth/                       # AuthGuard, PermissionGuard, PermissionButton
    ui/                         # HeroUI 封装
  contexts/
    auth-context.tsx            # 用户信息 + 权限码 Set
  lib/
    api.ts                      # fetch 封装 + 401 刷新拦截
```

---

## 技术栈版本

系统中的已有版本，直接沿用，不新增依赖：
- NestJS 11, Prisma, PostgreSQL（后端）
- Next.js 16, Tailwind 4, HeroUI（前端）
