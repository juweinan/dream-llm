# User System — RBAC 权限管理后端

## Prerequisites

- PostgreSQL 本地运行（默认 `localhost:5432`）
- Bun >= 1.3

## 首次启动

```bash
# 1. 创建数据库
createdb rbac_dev

# 2. 安装依赖（根目录）
cd /Users/juweinan/code/projects/study-ai/dream-llm
bun install

# 3. 初始化数据库（迁移 + 种子数据）
cd services/user-system
npx prisma migrate dev --name init-rbac
npx ts-node prisma/seed.ts

# 4. 启动（端口 4002）
cd /Users/juweinan/code/projects/study-ai/dream-llm
bun run dev:rbac
```

## 种子数据

种子脚本 (`prisma/seed.ts`) 自动创建：

| 资源 | 内容 |
|------|------|
| 用户 | `super_admin` / `admin123` (Super Admin) |
| 角色 | 系统管理员 (admin) — 全权、普通用户 (viewer) — 只读 |
| 权限 | 5 个页面查看 + 8 个按钮操作 = 13 个权限码 |
| 授权 | super_admin → admin 角色 → 全部 13 个权限 |

## API 概览

- `POST /api/auth/login` — 登录，返回 accessToken + Set-Cookie refreshToken
- `POST /api/auth/refresh` — 刷新 token（cookie auto-include）
- `POST /api/auth/logout` — 吊销 refreshToken
- `GET /api/account/me` — 当前用户 + 权限码列表
- `GET/POST/PATCH/DELETE /api/users` — 用户 CRUD（需权限）
- `GET/POST/PATCH/DELETE /api/roles` — 角色 CRUD（需权限）
- `GET /api/permissions` — 权限树（需权限）
- `GET /api/audit-logs` — 审计日志（只读，需权限）
