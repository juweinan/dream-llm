# Admin Web — RBAC 权限管理前端

## 启动

```bash
cd clients/admin-web
bun install
bun run dev   # 端口 3001
```

或从根目录统一启动（同时启动后端 4002）：
```bash
cd /Users/juweinan/code/projects/study-ai/dream-llm
bun run dev:rbac
```

## 架构

- Next.js 16 App Router
- Axios (baseURL: `/api`) + 401 拦截器自动刷新
- AuthContext (React Context) 管理全局认证状态
- 权限组件: `AuthGuard` / `PermissionGuard` / `PermissionButton`
- Next.js rewrites 代理 `/api/*` → `http://localhost:4002`

## 页面

| 路由 | 功能 | 权限码 |
|---|---|---|
| `/login` | 登录 | — |
| `/dashboard` | 仪表盘 | `dashboard:page:view` |
| `/users` | 用户管理（表格 + Drawer） | `user:page:view` |
| `/roles` | 角色管理（表格 + 权限树分配） | `role:page:view` |
| `/permission-center` | 权限树 | `permission:page:view` |
| `/profile` | 个人信息 + 权限列表 | 登录即可 |

## 默认账户

`super_admin` / `admin123`
