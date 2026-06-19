# 2026-06-16 Post-Mortem: services/chat 数据库初始化

## 耗时

**6 小时**（15:00 → 21:00），实际工作量约 10 分钟。

## 错误清单

### 1. 依赖安装阶段（最主要的浪费时间）

**问题**：`bun add` 和 `bun install` 在 monorepo 下反复卡在 "Resolving dependencies"。

**根因**：bun workspace 每次 `add` / `install` 都会扫描所有包做全量版本解析。没有先诊断就反复重试、频繁 kill 进程。

**犯的错**：
- 使用 `--verbose` 导致 HTTP 调试日志写满临时文件系统（ENOSPC），后续命令全部失败，但没及时发现这个原因
- 清空 bun 缓存后反而更慢（所有包要重新下载），但没意识到这一点
- 最终通过先恢复到与 `bun.lock` 一致的状态再 `bun install` 确认了 6.73s 即可完成，然后单独 `bun add pg` 也在 4s 内完成——说明一开始就应该一个一个装而不是一把梭

### 2. 瞎编版本号

**问题**：手动往 `package.json` 里写 `"@prisma/client": "^7.0.1"` 等依赖。

**错误**：`7.0.1` 是我编的，实际最新是 `7.8.0`。绝不应当手写版本号，必须让包管理器自己解析。

### 3. PostgreSQL 版本混乱

**问题**：系统有 PG16，pgvector 编译给了 PG17/18。应该先检查 pgvector 的兼容性，而不是卸载 PG16 又试图装 PG18。且使用了 `postgresql@18`、`postgresql@latest` 等不确定的 formula 名。

**正解**：用户自己装好了 PG18，brew formula 名就是 `postgresql@18`。

### 4. Prisma config 写法反复

**问题**：`process.env["DATABASE_URL"]` → 改成 `env("DATABASE_URL")` → 又改回 `process.env["DATABASE_URL"]`。

两个都可用，但 migrate 命令失败的原因不是写法问题，而是没有在 `services/chat/` 目录下执行（`.env` 文件才被 Prisma 加载）。

### 5. 工作的 cwd 不明确

**问题**：多次在 workspace 根目录执行 `bun run db:generate`（报 Script not found）、在根目录执行 `npx prisma migrate`（报找不到 schema）。

**根因**：没有在命令中明确 `cd services/chat` 或使用 `--schema` 绝对路径。

### 6. 沟通问题

- 长时间后台任务没有进展时，没有主动向用户同步状态
- 用户多次打断才解释卡在哪里，而不是提前预警

## 正确的执行方式

```bash
# 1. 安装依赖（一个一个来，不要一把梭）
cd services/chat
bun add pg
bun add prisma
bun add @prisma/client
bun add @prisma/adapter-pg

# 2. 确保 PostgreSQL + pgvector 就绪
brew services start postgresql@18
psql -d postgres -c "CREATE DATABASE chat;"
psql -d chat -c "CREATE EXTENSION vector;"

# 3. 从 services/chat 目录执行 Prisma 命令
cd services/chat
DATABASE_URL="postgresql://juweinan@localhost:5432/chat" npx prisma migrate dev --name init
DATABASE_URL="postgresql://juweinan@localhost:5432/chat" npx prisma generate
```

## 红牌规则

1. **绝不手写依赖版本号** — 让包管理器解析
2. **安装卡住先诊断，不要反复 kill/重试** — 检查进程、网络、磁盘空间
3. **不要 `--verbose` 输出到临时文件系统** — 会撑爆
4. **Prisma 命令必须在含 `.env` 的目录下执行**，或显式传 `DATABASE_URL`
5. **不确定的 formula/包名先用 `brew search` / `npm search` 确认**
