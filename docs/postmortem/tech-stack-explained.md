# PostgreSQL + Prisma + pgvector 技术栈详解

## 目录

1. [概述：这些组件分别是什么，为什么要一起用](#1-概述)
2. [PostgreSQL：关系型数据库](#2-postgresql)
3. [pgvector：向量扩展](#3-pgvector)
4. [Prisma：ORM 工具链](#4-prisma)
5. [项目文件结构与数据流](#5-项目文件结构)
6. [Schema 设计详解](#6-schema-设计)
7. [PrismaService 与 NestJS 集成](#7-prismaservice-与-nestjs-集成)
8. [Prisma CLI 命令详解](#8-prisma-cli-命令)
9. [Embedding 与 AI 向量检索](#9-embedding-与-ai-向量检索)
10. [完整技术架构图](#10-完整技术架构)
11. [核心纪律](#11-核心纪律)
12. [关键术语速查表](#12-关键术语速查表)

---

## 1. 概述

### 1.1 三层是什么

| 层 | 是什么 | 类比 |
|----|--------|------|
| **PostgreSQL** | 关系型数据库，存数据 | Excel 工作簿（有表、有行、有列） |
| **pgvector** | PostgreSQL 的一个扩展，让数据库能存"向量"并做向量相似度搜索 | 给 Excel 装了插件，让它能存高维数学数组并比较"谁跟谁更像" |
| **Prisma** | ORM（对象关系映射），让你用 TypeScript 代码代替手写 SQL 来操作数据库 | 翻译官，你把"我要查姓王的所有用户"用代码方法调用，它翻译成 `SELECT * FROM users WHERE name LIKE '王%'` |

### 1.2 为什么配合使用

```
你写的 TypeScript 代码
        │
        ▼
     Prisma Client          ←── 由 prisma generate 根据 schema.prisma 生成
        │
        ▼
     pg (node-postgres)     ←── 实际的 PostgreSQL 网络协议驱动
        │
        ▼
   PostgreSQL 数据库
        │
        ├── 普通表           ←── conversations, messages, documents...
        └── pgvector 扩展    ←── document_chunks.embedding (向量字段)
```

**一句话**：Prisma 让你不用手写 SQL，pgvector 让 PostgreSQL 能做 AI 语义搜索（而不仅是等值查询），两者跑在同一个数据库里，不需要再装一个向量数据库。

### 1.3 为什么不单独装 Qdrant / Milvus / Pinecone？

这个项目当前阶段用的是内存向量存储（`MemoryVectorStore`），不依赖外部向量数据库。但 `document_chunks` 表的 `embedding` 字段用了 pgvector 类型，为将来把向量持久化到 PostgreSQL 做好了准备——这样**一个数据库同时存业务数据和向量数据**，省掉一个基础设施。

---

## 2. PostgreSQL

### 2.1 是什么

PostgreSQL 是一个开源关系型数据库管理系统（RDBMS），已有近 30 年历史。

关系型数据库的核心概念：

- **数据库（Database）**：最高层次的逻辑容器，一个 PG 实例可以装多个数据库
- **Schema**：数据库内部的命名空间，默认叫 `public`，用来组织表
- **表（Table）**：数据存储的基本单元，由行和列组成
- **行（Row）**：一条记录
- **列（Column）**：字段，有明确的数据类型

### 2.2 数据类型

本项目用到的 PG 类型：

| PG 类型 | Prisma 写法 | 含义 |
|----------|------------|------|
| `TEXT` | `String` | 不限长度的字符串 |
| `INTEGER` | `Int` | 32 位整数 |
| `TIMESTAMP(3)` | `DateTime` | 毫秒精度的时间戳 |
| `JSONB` | `Json` | 二进制 JSON（可索引，查询更快） |
| `UUID` | `@default(uuid())` | 全局唯一 ID |
| `vector` | `Unsupported("vector")` | pgvector 扩展提供的向量类型 |

### 2.3 外键与 Cascade 删除

```prisma
model Message {
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}
```

`onDelete: Cascade` 的意思是：**删除 Conversation 时，自动删除它下面的所有 Message**。没有这一行的话，删 Conversation 会因为外键约束而失败（有 Message 还引用着它）。

### 2.4 ENUM (枚举)

```sql
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');
```

PG 里 ENUM 是数据库层面定义的类型，插入数据时如果值不在枚举列表中会直接拒绝。比用 String + 应用层校验更安全。

### 2.5 本机开发连接方式

```env
DATABASE_URL=postgresql://juweinan@localhost:5432/chat
```

格式：`postgresql://用户名[:密码]@主机:端口/数据库名`

本机开发通常不用密码（通过 Unix socket 认证），生产环境一定要设密码。

---

## 3. pgvector

### 3.1 是什么

pgvector 是 PostgreSQL 的一个扩展（Extension），由一家叫 Supabase 的公司主导开发。它给 PostgreSQL 增加了：

1. **`vector` 数据类型**：存一组浮点数数组（通常 384 / 768 / 1536 维）
2. **向量相似度运算符**：`<->` (欧氏距离)、`<=>` (余弦距离)、`<#>` (内积)
3. **向量索引（IVFFlat / HNSW）**：加速大规模向量搜索

### 3.2 向量是什么

把一段文字通过 Embedding 模型转换成一串固定长度的数字，这串数字就是这段文字的"语义指纹"。

```
"我喜欢吃苹果"   ──Embedding──►  [0.02, -0.13, 0.87, ..., 0.41]  (384个浮点数)
"Apple is tasty"  ──Embedding──►  [0.01, -0.11, 0.85, ..., 0.39]  (384个浮点数)
"明天会下雨"      ──Embedding──►  [-0.31, 0.52, -0.19, ..., 0.03]  (384个浮点数)
```

两个向量越"近"（余弦距离越小），两段文字语义越相似。所以"我喜欢吃苹果"和"Apple is tasty"会非常接近，而"明天会下雨"和前两者都远。

### 3.3 为什么用 pgvector 而不是专门的向量数据库

| 对比 | pgvector | Qdrant/Milvus/Pinecone |
|------|----------|------------------------|
| 需要额外部署 | 不需要，装在 PG 里就行 | 需要独立服务和运维 |
| 数据一致性 | 业务数据 + 向量在同一个事务里 | 两套系统间的事务很难保证 |
| 查询能力 | 可以 `JOIN` 和 `WHERE` 混用 | 通常只做向量搜索 |
| 适用规模 | 百万级向量以下 | 亿万级向量 |

**本项目选 pgvector 的原因**：chat 场景向量规模不会特别大（每段文档一个向量），用 pgvector 更简单，一个数据库就够。

### 3.4 安装方式

```bash
brew install pgvector                          # 安装扩展
psql -d chat -c "CREATE EXTENSION vector;"     # 在数据库里启用
```

`prisma migrate` 会自动执行 `CREATE EXTENSION IF NOT EXISTS "vector"`。

---

## 4. Prisma

### 4.1 是什么

Prisma 是一个 Node.js / TypeScript 生态的 ORM 工具链，包含三部分：

| 部分 | 作用 |
|------|------|
| **Prisma Schema** | 用 DSL（领域特定语言）描述数据库模型，是唯一的真相来源 |
| **Prisma Migrate** | 比较 schema 和数据库，自动生成并执行 SQL 迁移 |
| **Prisma Client** | 自动生成的 TypeScript 类型安全查询客户端 |

### 4.2 Prisma 7 的变化

Prisma 7 相比之前版本有几个重要变化：

1. **datasource.url 不在 schema.prisma 里写了**，改为在 `prisma.config.ts` 中配置
2. **新增 `prisma.config.ts`**：用 TypeScript 配置文件代替硬编码连接字符串
3. **预览特性 `postgresqlExtensions`**：正式支持 pgvector 等 PostgreSQL 扩展

### 4.3 prisma.config.ts 怎么工作

```typescript
// services/chat/prisma.config.ts
import "dotenv/config";                          // 1. 加载 .env → process.env
import { defineConfig } from "prisma/config";    // 2. Prisma 7 的配置工具

export default defineConfig({
  datasource: {
    url: process.env["DATABASE_URL"],            // 3. 从环境变量读数据库地址
  },
});
```

**加载流程**：Prisma CLI 启动 → 读 `prisma.config.ts` → `import "dotenv/config"` 执行 → `.env` 中的 `DATABASE_URL` 被注入 `process.env` → Prisma 拿到连接地址。

### 4.4 Schema DSL 关键语法

```prisma
// generator：指定用什么生成客户端代码
generator client {
  provider        = "prisma-client-js"           // 生成 JS/TS 客户端
  previewFeatures = ["postgresqlExtensions"]     // 开启 pgvector 支持
}

// datasource：指定数据库类型和扩展
datasource db {
  provider   = "postgresql"                      // 数据库是 PostgreSQL
  extensions = [vector]                          // 安装了 vector 扩展
}

// enum：数据库层面的枚举
enum MessageRole {
  USER
  ASSISTANT
}

// model：对应数据库的一张表
model Conversation {
  id        String   @id @default(uuid())        // 主键，默认 UUID
  userId    String                               // 裸字符串，无外键关联
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages  Message[]                            // 反向关系，不是一个真实字段
}

// Unsupported：告诉 Prisma "这个字段 PG 有，但你别管，原生处理"
model DocumentChunk {
  embedding Unsupported("vector")
}
```

### 4.5 为什么 userId 不用外键

用户数据由另一个微服务 `user-system` 维护，不在这个数据库里。加了外键意味着 PG 会检查引用完整性（Message 的 userId 必须存在于 User 表），但 User 表不在这个库里，所以**加外键反而会报错**。用裸 String 保持灵活性，关联逻辑在应用层处理。

---

## 5. 项目文件结构

```
services/chat/
├── .env                           # 环境变量（DATABASE_URL 等）
├── prisma.config.ts               # Prisma 7 数据库连接配置
├── package.json                   # 依赖和 npm scripts
│
├── prisma/
│   ├── schema.prisma              # ★ 核心：数据模型定义（唯一的真相来源）
│   └── migrations/
│       ├── migration_lock.toml    # 迁移锁，防止多人同时迁移冲突
│       └── 20260616133337_init/
│           └── migration.sql      # 由 schema 自动生成的 SQL
│
└── src/
    ├── main.ts                    # 应用入口，import "dotenv/config"
    ├── app.module.ts              # 根模块（尚未导入 PrismaModule）
    │
    ├── prisma/                    # ★ 数据库访问层
    │   ├── prisma.service.ts      # Prisma 客户端封装（继承 PrismaClient）
    │   └── prisma.module.ts       # NestJS Global 模块
    │
    └── llm/                       # LLM 相关业务逻辑
        ├── embedding/
        │   ├── embedding.service.ts     # Embedding 模型（本地运行）
        │   └── vector-store.service.ts  # 内存向量存储 + 相似度检索
        ├── memory/
        │   └── runnable-memory.service.ts  # 对话记忆管理
        ├── agents/
        │   ├── orchestrator.service.ts     # Multi-Agent 编排
        │   └── sub-agents.ts              # 子 Agent 定义
        └── ...（其余省略）
```

---

## 6. Schema 设计详解

### 6.1 五张表的关系

```
Conversation (对话会话)          TaskEvent (异步任务事件)
     │ 1
     │ has many
     ▼ N
  Message (聊天消息)             Document (上传的文档)
                                     │ 1
                                     │ has many
                                     ▼ N
                               DocumentChunk (文档切片 + 向量)
```

### 6.2 conversations 表

```prisma
model Conversation {
  id        String    @id @default(uuid())
  userId    String
  title     String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}
```

- **id**：UUID 主键，分布式系统里比自增 ID 更好（不会冲突）
- **userId**：存储 `user-system` 微服务中的用户 ID，裸 String
- **messages**：Prisma 的虚拟关系字段，不在数据库里占空间，但让你写 `conversation.messages` 时能直接拿到关联的 Message 列表

### 6.3 messages 表

```prisma
model Message {
  id             String      @id @default(uuid())
  conversationId String
  role           MessageRole
  content        String
  metadata       Json?
  createdAt      DateTime    @default(now())
  conversation   Conversation @relation(..., onDelete: Cascade)
}
```

- **role**：枚举 `USER` 或 `ASSISTANT`
- **metadata**：Json 类型，存不固定结构的额外信息（比如 token 用量、模型版本、工具调用记录）
- **onDelete: Cascade**：删除会话时自动删除所有消息

### 6.4 documents 表

```prisma
model Document {
  id          String   @id @default(uuid())
  userId      String
  filename    String
  mimeType    String
  size        Int
  filePath    String?
  storageType String   @default("local")
  status      String   @default("pending")
  chunkCount  Int      @default(0)
  createdAt   DateTime @default(now())
  chunks      DocumentChunk[]
}
```

- **storageType**：默认 `local`，后续可以扩展 `s3`、`oss`
- **status**：文档上传后默认 `pending`（待处理→处理中→完成）
- **chunkCount**：文档被切成了几段，每段对应一个 DocumentChunk+向量

### 6.5 document_chunks 表（核心 AI 表）

```prisma
model DocumentChunk {
  id         String   @id @default(uuid())
  documentId String
  content    String
  chunkIndex Int
  embedding  Unsupported("vector")
  document   Document @relation(..., onDelete: Cascade)
}
```

- **chunkIndex**：切片的序号（第 0 段、第 1 段...）
- **embedding**：`Unsupported("vector")` 告诉 Prisma "这个字段由 pgvector 原生管理，你别碰它的类型"。Prisma Client 读写这个字段时用 `Unsupported` 类型，需要手动处理向量数组转换
- **为什么切片**：Embedding 模型有输入长度限制（通常 512 tokens），长文档必须切成小块

### 6.6 task_events 表

```prisma
model TaskEvent {
  id        String     @id @default(uuid())
  userId    String
  taskType  String
  taskId    String
  status    TaskStatus
  message   String?
  metadata  Json?
  createdAt DateTime   @default(now())
  readAt    DateTime?
}
```

一个轻量级的异步任务事件记录表。比如文档上传后触发一个"文档处理"任务，处理进度就可以存在这里，前端轮询查询。

- **readAt**：用户已读时间，null 表示未读，可用于前端通知小红点

---

## 7. PrismaService 与 NestJS 集成

### 7.1 依赖注入链路

```
main.ts (import "dotenv/config")
    │
    │ NestFactory.create(AppModule)
    │
    ▼
AppModule
    │
    ├── imports: LlmModule, AdvancedModule
    │   （目前在 app.module.ts 中尚未导入 PrismaModule，需要加）
    │
    └── 任何 Module 都可以直接注入 PrismaService
        （因为 PrismaModule 被 @Global() 装饰）
```

### 7.2 PrismaService 代码拆解

```typescript
import { PrismaClient } from "@prisma/client";   // 由 prisma generate 生成的类型化客户端
import { PrismaPg } from "@prisma/adapter-pg";   // Prisma 7 的 PG 驱动适配器
import { Pool } from "pg";                       // node-postgres 的连接池

@Injectable()
export class PrismaService
  extends PrismaClient         // 继承自动生成的客户端，获得全部查询方法
  implements OnModuleInit, OnModuleDestroy   // NestJS 生命周期钩子
{
  private pool: Pool;

  constructor() {
    // 1. 创建 PG 连接池
    const pool = new Pool({
      connectionString: process.env["DATABASE_URL"],
    });

    // 2. 用 PrismaPg 适配器包装连接池
    const adapter = new PrismaPg(pool);

    // 3. 传给父类 PrismaClient
    super({ adapter });

    this.pool = pool;
  }

  // NestJS 模块初始化 → 连接数据库
  async onModuleInit() {
    await this.$connect();
  }

  // NestJS 模块销毁 → 断开数据库
  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
```

### 7.3 为什么用 @prisma/adapter-pg 而不是 Prisma 内置连接

Prisma 7 把数据库连接改成了插件架构。`@prisma/adapter-pg` 使用 `pg`（node-postgres）的 `Pool` 作为底层连接池，好处：

1. **连接池由你控制**：可以调连接数上限、超时等参数
2. **可以复用同一个 Pool**：如果其他代码需要直接发 SQL，可以共享连接池
3. **更好的性能**：`pg` 是 Node.js 生态里最快的 PostgreSQL 驱动之一

### 7.4 @Global() 装饰器的作用

```typescript
@Global()                    // ← 这个
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

正常情况下，A 模块想用 B 模块的 Service，A 必须 `imports: [BModule]`。`@Global()` 后，**任何模块都不需要显式 import**，直接注入 `PrismaService` 即可。适合像数据库客户端这种全局唯一的底层服务。

---

## 8. Prisma CLI 命令

### 8.1 db:migrate (`prisma migrate dev`)

```bash
bun run db:migrate
```

**做什么**：比较 `schema.prisma` ↔ 数据库实际结构，有差异就生成 SQL 并执行。

**执行流程**：
```
读 schema.prisma
       │
       ▼
连接数据库，读取当前 DDL 结构
       │
       ▼
┌── 有差异？── 生成 migration.sql ── 执行它 ── 更新 prisma/migrations/
│
└── 无差异？── Already in sync
```

**什么时候用**：修改 `schema.prisma` 后，想把改动同步到数据库。

**注意**：这个命令是开发用的。生产环境用 `prisma migrate deploy`（只执行已有迁移文件，不生成新文件）。

### 8.2 db:generate (`prisma generate`)

```bash
bun run db:generate
```

**做什么**：根据 `schema.prisma` 生成 Prisma Client 的 TypeScript 类型代码。

**不连数据库**，只读 schema 文件。生成物在 `node_modules/.prisma/client/`。

```typescript
// 你能这样写，全靠 generate 生成的类型：
const messages = await prisma.message.findMany({
  where: { role: "USER" },        // ← role 有类型提示，不会写错
  select: { content: true },      // ← content 有类型提示
});
// messages 的类型是 Array<{ content: string }>  ← 自动推导
```

**什么时候用**：修改 `schema.prisma` 后，需要更新类型。`db:migrate` 执行完也会自动替你跑一遍。

### 8.3 db:studio (`prisma studio`)

```bash
bun run db:studio
```

**做什么**：在浏览器打开 `http://localhost:5555`，可视化管理数据库——看表、增删改数据。类似 phpMyAdmin 但只读 schema 自动生成界面。

---

## 9. Embedding 与 AI 向量检索

### 9.1 Embedding 模型

本项目用的模型：`Xenova/paraphrase-multilingual-MiniLM-L12-v2`

| 属性 | 值 |
|------|-----|
| 运行位置 | **本地**（浏览器/Node.js，不调 API） |
| 框架 | `@xenova/transformers`（Transformers.js） |
| 向量维度 | **384 维** |
| 语言 | 多语言（支持中文） |
| 最大输入 | 约 512 tokens |

### 9.2 一段文字怎么变成向量

```typescript
// embedding.service.ts 核心逻辑

// 1. 加载模型（只加载一次，复用）
const extractor = await pipeline('feature-extraction', MODEL_NAME);

// 2. 输入文字 → 输出向量
const output = await extractor("用户注册时必须绑定手机号", {
  pooling: 'mean',     // 对 384 个 token 向量求均值 → 得到 1 个句向量
  normalize: true,     // L2 归一化，让向量长度 = 1
});

// 3. Float32Array → 普通 number[]
const vector = Array.from(output.data as Float32Array);
// vector = [0.02, -0.13, 0.87, ..., 0.41]  (384 个数字)
```

### 9.3 向量相似度搜索

```typescript
// 用户问："手机号验证"
const queryVector = await embedding.embedQuery("手机号验证");
// → [0.15, -0.08, 0.92, ...]

// 在向量库里搜索最相似的 k=3 个文档
// 内部计算：queryVector 和每个存着的文档向量的余弦距离
const results = await store.similaritySearchVectorWithScore(queryVector, 3);

// 结果：
// 1. "用户注册时必须绑定手机号"  score: 0.89  ← 最相关
// 2. "密码需要包含大小写字母"    score: 0.32
// 3. "系统支持 OAuth2 登录"      score: 0.11  ← 不相关
```

### 9.4 当前状态 vs 未来计划

| | 当前实现 | 未来的 pgvector 实现 |
|------|---------|-------------------|
| 向量存在哪 | **内存**（MemoryVectorStore） | **PostgreSQL**（document_chunks.embedding） |
| 重启应用后 | 向量丢失，需要重新加载 | 持久化，永不丢失 |
| 搜索方式 | JS 内存遍历比较 | SQL `ORDER BY embedding <=> $1 LIMIT k` |
| 数据量 | 受内存限制 | 可存百万级向量 |

**未来迁移路径**：把 `VectorStoreService` 中的 `MemoryVectorStore` 替换为 `PGVectorStore`（LangChain 内置了对 pgvector 的支持），`document_chunks` 表就是为这个准备的。

### 9.5 RAG 是什么

RAG = Retrieval Augmented Generation（检索增强生成），是一种 AI 架构模式：

```
用户提问："怎么修改密码？"
        │
        ▼
 1. Embedding 模型把问题转为向量
        │
        ▼
 2. 在 pgvector 中搜索相关文档切片
     → 找到："密码修改需要旧密码验证，新密码至少8位..."
        │
        ▼
 3. 拼接 Prompt：
     "参考以下文档回答问题：{检索到的文档}\n\n问题：怎么修改密码？"
        │
        ▼
 4. 发给 LLM 生成回答
     → 输出："您需要先输入旧密码进行验证，然后设置至少8位的新密码"
```

RAG 解决了 LLM 的两个核心短板：
- **知识过期**：LLM 训练数据有截止日期，RAG 让它能查最新文档
- **幻觉**：LLM 可能编造答案，RAG 让它基于真实文档回答

---

## 10. 完整技术架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (clients/chat-web)                                     │
│  Next.js 应用，用户聊天界面                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (localhost:4001)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  NestJS 应用 (services/chat)                                  │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Controllers 层                                         │  │
│  │  llm.controller.ts / embedding.controller.ts / ...     │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                     │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │ Services 层                                            │  │
│  │                                                        │  │
│  │  LlmService ──→ LangChain ──→ 调用 LLM API             │  │
│  │  EmbeddingService ──→ Transformers.js ──→ 本地模型      │  │
│  │  VectorStoreService ──→ MemoryVectorStore ──→ 内存向量  │  │
│  │  PrismaService ──→ Prisma Client ──→ pg Pool ──→ DB    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                       │ TCP (localhost:5432)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL 18 + pgvector (chat 数据库)                       │
│                                                               │
│  ┌──┬──┬──┬──┬──────────────┐  ┌────────────────────────┐  │
│  │C │M │D │DC│     TE       │  │     pgvector 扩展        │  │
│  │o │e │o │o │              │  │                          │  │
│  │n │s │c │c │ TaskEvent    │  │  向量存储 + 相似度搜索    │  │
│  │v │s │u │u │   (任务事件)  │  │  <-> <=> <#> 运算符      │  │
│  │e │a │m │m │              │  │  IVFFlat / HNSW 索引     │  │
│  │r │g │e │e │              │  └────────────────────────┘  │
│  │s │e │n │n │              │                               │
│  │a │s │t │t │              │                               │
│  │t │  │s │s │              │                               │
│  │i │  │  │  │              │                               │
│  │o │  │  │  │              │                               │
│  │n │  │  │  │              │                               │
│  │s │  │  │  │              │                               │
│  └──┴──┴──┴──┴──────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. 核心纪律

### 唯一真相来源

**`schema.prisma` 是数据库结构的唯一真相来源。** 这个文件说了算，数据库必须跟它一致，绝不能反过来。

### 正确的工作流

```
✅ 正确：schema.prisma  ──db:migrate──►  数据库
❌ 错误：数据库  ──直接改──►  不一致
```

**永远只改 `schema.prisma`，通过 `db:migrate` 同步数据库，不要直接操作数据库改结构。**

### 为什么不能直接改数据库

| 后果 | 说明 |
|------|------|
| **类型不一致** | `db:generate` 根据 schema 生成 TS 类型，数据库改了但类型没更新，运行时拿到的数据和类型定义对不上，编译期不报错，运行时炸 |
| **Drift 冲突** | 下次跑 `db:migrate`，Prisma 发现数据库和 schema 不一样，会报 drift（漂移），要求你 `prisma migrate reset`（删库重建，数据全丢） |
| **文件可信度崩塌** | 新同事看 `schema.prisma` 以为是表 A，实际是表 B。文档可信度一崩塌，维护成本急剧上升 |
| **迁移历史断裂** | `prisma/migrations/` 记录的是从 schema 生成的每一次变更。直接改数据库绕过了这个历史，团队没人知道这个变更是谁做的、什么时候做的、为什么做的 |

### 正确的日常操作

```
1. 改 schema.prisma  （加字段、改类型、加表…）
       │
2. bun run db:migrate （自动对比 + 生成迁移 SQL + 执行 + 更新类型）
       │
3. 业务代码里直接用 PrismaService 的新字段（类型已自动更新）
```

### Prisma Studio 的定位

`bun run db:studio` 可以可视化地**看数据和临时修改数据**（比如测试时手动改一行数据），但不能替代 schema 变更。永远不要用 Studio 或 SQL 改表结构。

---

## 12. 关键术语速查表

| 术语 | 一句话解释 |
|------|-----------|
| **ORM** | Object-Relational Mapping，用代码对象代替手写 SQL |
| **Migration** | 数据库结构变更的版本管理，像 Git 但管的是 DDL |
| **DDL** | Data Definition Language，建表/改表/删表的 SQL |
| **DML** | Data Manipulation Language，增删改数据的 SQL |
| **连接池 (Pool)** | 预建一组数据库连接复用，避免每次查询都重新连接 |
| **UUID** | 全局唯一 ID，`550e8400-e29b-41d4-a716-446655440000` |
| **Cascade** | 级联操作，删父记录自动删子记录 |
| **Embedding** | 把文字转成数字向量的过程 |
| **向量 (Vector)** | 一组浮点数，代表一段文字的语义 |
| **向量维度** | 向量里数字的个数，256/384/768/1536 等 |
| **余弦相似度** | 衡量两个向量"方向"相近程度，[-1, 1]，越大越像 |
| **L2 归一化** | 把向量长度缩放到 1，之后余弦相似度 = 内积 |
| **RAG** | 检索 → 增强 → 生成，让 LLM 能基于真实文档回答 |
| **Token** | 文本的最小处理单元，约 1 个中文字 = 1 token，1 个英文词 ≈ 1.3 token |
| **DI (依赖注入)** | NestJS 的自动 new 对象机制，不需要手动 `new XxxService()` |
| **@Global()** | NestJS 装饰器，标记模块为全局可用 |
