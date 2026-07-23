# Dream-LLM Chat 服务 — 产品现状评估与改进方案

> 评估日期：2026-07-23
> 评估人：(产品经理视角)
> 评估范围：`services/chat/` 完整代码库
> 版本：基于 commit `9c8422b` (master)

---

## 目录

1. [系统概述](#1-系统概述)
2. [现有能力清单](#2-现有能力清单)
3. [已知缺陷详解（用户提出的 3 项）](#3-已知缺陷详解用户提出的-3-项)
4. [新发现的缺陷详解（14 项）](#4-新发现的缺陷详解14-项)
5. [综合评分](#5-综合评分)
6. [改进路线图](#6-改进路线图)
7. [每项缺陷的详细实现方案](#7-每项缺陷的详细实现方案)

---

## 1. 系统概述

Dream-LLM Chat 是一个基于 **NestJS + LangGraph** 构建的 RAG（检索增强生成）需求分析系统。核心架构如下：

```
POST /api/advanced/analyze
  └─ AdvancedAnalysisService.analyze()
       ├─ Step 1: 读取 DB 对话历史 (MessageService)
       ├─ Step 2: 语义检索用户文档 (SearchService → pgvector)
       ├─ Step 3: 拼接上下文 (历史 + 检索结果)
       ├─ Step 4: 多 Agent 编排分析 (OrchestratorService → LangGraph)
       └─ Step 5: 写回 messages 表
```

**LangGraph 图结构（需求分析主图）：**

```
START → triage → extract → clarify → analysisSupervisor → risk → summary → END
             ├─ answer     → END
             ├─ handoff_to_risk → risk → summary → END
             └─ query → queryHandler → END

analysisSupervisor (子图):
  supervisor → [functional ‖ performance ‖ security ‖ compliance] → aggregator
```

**外层 Plan-and-Execute 流水线：**

```
START → planner → executor ⇄ executor (多步骤) → evaluator → END
                                                     └(不通过)→ reflector → executor
```

整体技术选型合理，架构思路清晰，是一个典型的 **Multi-Agent RAG + 需求分析** 系统雏形。但从**生产级应用交付**的标准审视，存在 17 项重大缺陷，以下逐一详述。

---

## 2. 现有能力清单

### 已实现且质量较高的部分

| 能力 | 实现情况 | 质量 |
|------|---------|------|
| Multi-Agent Supervisor 编排 | Supervisor + 4 专家并行分析（Send[]）+ Aggregator 合并 | ★★★★☆ |
| Handoff 分诊 | triageNode → answer/analysis/risk 三路分发 + keyword 降级 | ★★★★☆ |
| Plan-and-Execute + Reflexion | 外层流水线支持多步骤联合分析 + 反思重试（上限 1 次）| ★★★☆☆ |
| Critic-Refine 质量门禁 | 报告生成 → 评审 → 修订循环（上限 2 次）| ★★★☆☆ |
| ReAct Agent 子图 | 工具调用循环 + 轮次上限 + 降级标记 | ★★★★☆ |
| Token 成本追踪 | TokenUsageService + 月度/节点/Agent 聚合 + 预算策略 | ★★★★☆ |
| 预算策略（模型降级） | resolveBudgetAction + resolveModelForAgent 决策 | ★★★★☆ |
| 消息裁剪（trimmer） | maxMessages 裁剪 + orphan ToolMessage 清理 | ★★★★☆ |
| 对话摘要压缩（compressor） | LLM 摘要早期消息 + 保留最近 N 条 | ★★★☆☆ |
| Document → Chunk → Embedding | 本地方案（Xenova transformers）+ pgvector 存储 | ★★★☆☆ |
| SSE 进度推送 | TaskEvent 持久化 + 实时推送 + 30 分钟定时清理 | ★★★★☆ |
| UI 协议（结构化输出） | Zod Schema + discriminatedUnion + 状态机流转 | ★★★☆☆ |
| Swagger/OpenAPI 文档 | 自动生成 API 文档 | ★★★★☆ |

---

## 3. 已知缺陷详解（用户提出的 3 项）

### 缺陷 #1：Checkpointer 仅为 Demo 级别

**严重程度：🔴 P0 — 阻塞生产部署**

**现状：**

[postgres-checkpointer.ts](../services/chat/src/llm/graph/postgres-checkpointer.ts) 中，`getCheckpointer()` 返回 `MemorySaver`，所有图状态仅存在于进程内存中：

```typescript
// 当前实现（第 32-38 行）
export function getCheckpointer(): BaseCheckpointSaver {
  if (!instance) {
    instance = new MemorySaver();
    console.log('[Checkpointer] 使用 MemorySaver（进程内）');
  }
  return instance;
}
```

虽然注释中预写了 `PostgresSaver` 的备选实现，但从未被激活。

**影响分析：**

| 影响维度 | 描述 |
|---------|------|
| 服务重启 | 所有正在执行的图状态丢失，用户需重新提交 |
| 水平扩展 | 无法支持多实例部署（状态不共享） |
| 断点恢复 | 超时/异常后无法从上次断点继续，必须重跑全图 |
| 审计追溯 | 无法追溯历史图执行的中间状态 |
| Supervisor 并行 Send | 当 4 个专家并行时，若有 1 个超时，无法只重试失败的那个——这是 Send[] 机制的核心价值，MemorySaver 完全没有利用 |

**实现方案：** 见 [§7.1](#71-缺陷-1-checkpointer-生产级持久化)

---

### 缺陷 #2：缺少人工介入（Human-in-the-Loop / Interrupt）

**严重程度：🔴 P0 — 阻塞核心交互闭环**

**现状：**

全图中 **0 处** `interrupt()` 调用，**0 处** `Command` 使用。当前所谓的"澄清"流程完全不是真正的 HITL：

1. `clarifyNode` 调用 LLM 判断是否需要澄清
2. 如果需要，`runAnalysisGraph()` 返回 `status: 'clarification_needed'` + `clarificationQuestions`
3. 图直接停止，**一次性跑完**
4. 用户补充信息后，只能**全新执行一次图**——之前已经执行的 extract/classify 等节点全部重跑

这不是 Human-in-the-Loop，这是 **Human-after-the-Loop**：

```
真正的 HITL:  graph 暂停 → 人工输入 → graph 从暂停点继续
当前实现:     graph 跑完 → 返回问题 → 人工回答 → 重新跑全图
```

**影响分析：**

| 影响维度 | 描述 |
|---------|------|
| 用户体验 | 澄清后重跑全图，浪费 5-15 秒等待时间 |
| 成本浪费 | 已执行的 LLM 节点（extract、triage）全部重新计费 |
| 确定性 | 重新执行可能产生不同的中间结果，导致前后不一致 |
| 复杂场景 | 无法实现"执行到 risk 节点时发现需要人工确认某个高风险项，暂停并等待"这类生产级交互 |

此外，还有 `intent='query'` 场景（需求查询），以及 triage 无法判断时的升级场景，同样缺少 HITL 支持。

**实现方案：** 见 [§7.2](#72-缺陷-2-人工介入-human-in-the-loop)

---

### 缺陷 #3：缺少滑动窗口 & 历史摘要压缩

**严重程度：🟡 P1 — 严重制约长对话质量**

**现状分析：**

代码库中**存在** `conversation-compressor.ts` 和 `message-trimmer.ts`，但二者存在以下问题：

**3a. 未集成到主图流：**

| 模块 | 是否被主图调用 | 调用位置 |
|------|:---:|------|
| `trimMessagesForContext()` | ❌ | 仅有单元测试调用，主图中 0 次引用 |
| `compressConversation()` | ❌ | 仅有单元测试调用，主图中 0 次引用 |
| `RunnableMemoryService.chatTrimmed()` | ❌ | 仅在 `/api/memory/chat` 端点使用，与主图分析流无关 |

在 `AdvancedAnalysisService.analyze()` 中，对话历史的处理方式是**全部拼接**：

```typescript
// advanced-analysis.service.ts 第 86-91 行
const historyContext =
  historyMessages.length > 0
    ? historyMessages
        .map((msg) => `[${msg.getType()}]: ${msg.content}`)
        .join('\n')
    : '';
```

没有任何裁剪或摘要机制。当对话超过 20 轮后，拼接出的上下文会轻松超过 8000 tokens，再加上检索到的文档（3 块 × 500 字），直接触发上下文溢出或模型输出质量下降。

**3b. `compressConversation` 设计不够完善：**

- 摘要模型由调用方注入（`SummaryModel` 接口），但主图中从未注入
- 摘要输出格式依赖 LLM 自觉遵守，缺少 structured output 约束
- 没有摘要缓存——同一段早期对话每次压缩都重新调用 LLM
- 摘要与原始消息的权重没有区分度（均作为 SystemMessage 注入）

**3c. `RunnableMemoryService` 的双重问题：**

- 使用 `InMemoryChatMessageHistory`（进程内），重启丢失
- 方案本质上是 LangChain 官方已标记为过渡方案的旧 API
- `chatTrimmed` 的 tokenCounter 是**粗估**（`content.length / 3`），不准确

**影响分析：**

| 影响维度 | 描述 |
|---------|------|
| 多轮对话 | 超过 10 轮对话后，上下文爆炸导致分析质量急剧下降 |
| Token 成本 | 每次请求携带完整历史，token 成本线性增长 |
| 长会话 | 无摘要意味着模型无法"记住"早期讨论的关键结论 |
| 用户感知 | 分析质量随对话长度下降，体验不一致 |

**实现方案：** 见 [§7.3](#73-缺陷-3-滑动窗口--历史摘要压缩)

---

## 4. 新发现的缺陷详解（14 项）

### 缺陷 #4：RAG 检索未集成到图中

**严重程度：🔴 P0 — RAG 系统的结构性问题**

**现状：**

整个 LangGraph 图定义中，**没有检索节点**。检索发生在图的外部（`AdvancedAnalysisService` 中），以文本拼接的方式作为 `retrievedContext` 传入。图内的节点（extract、clarify、analysisSupervisor 等）通过 `state.retrievedContext` 读取——但：

1. 所有图节点（除 ReAct 子图的 agentNode 外）**没有在 prompt 中使用 retrievedContext**
2. `runAnalysisGraph()` 接受 `retrievedContext` 参数，但 State 中的 `retrievedContext` 字段从未被任何节点读取和使用
3. 这块的 RAG 实际上是 **"检索了但没用"** 的状态

在 `requirement-analysis-graph.ts` 中搜索 `retrievedContext`：
- Line 261: 定义在 State 中 ✅
- Line 1361: invoke 时传入 ✅
- 但所有节点的 system prompt 中均未引用 ❌

**与标准 RAG 系统的差距：**

| 标准 RAG 组件 | 本项目状态 |
|-------------|---------|
| Query Rewriting（查询重写） | ❌ 无 |
| Retrieval Node（检索节点） | ❌ 不在图中 |
| Reranking（重排序） | ❌ 无 |
| Context Compression（上下文压缩） | ❌ 无 |
| Source Attribution（来源标注） | ❌ 无 |
| Retrieval Grader（检索质量评估） | ❌ 无 |
| Query Transformation（多轮查询变换） | ❌ 无 |

**实现方案：** 见 [§7.4](#74-缺陷-4-rag-检索集成到图中)

---

### 缺陷 #5：仅有语义检索，缺少混合检索

**严重程度：🟡 P1**

**现状：**

[search.service.ts](../services/chat/src/llm/document/search.service.ts) 仅使用 pgvector 的余弦距离（`<=>`）进行语义检索：

```sql
SELECT ... FROM "DocumentChunk" dc
JOIN "Document" d ON d.id = dc."documentId"
WHERE d."userId" = $2
ORDER BY dc.embedding <=> $1::vector ASC
LIMIT $3
```

**缺失的能力：**

| 检索方式 | 适用场景 | 本项目 |
|---------|---------|:---:|
| Dense (语义) | 意图相近但措辞不同的查询 | ✅ |
| Sparse (BM25/关键词) | 精确术语、编号、代码匹配 | ❌ |
| Hybrid (融合) | 结合两者优势，取加权结果 | ❌ |

对于需求分析系统，典型查询如"REQ-2024-001 的认证模块"——这种带精确编号的查询，BM25 精确匹配会比语义检索效果好得多。仅有语义检索无法处理此类场景。

**实现方案：** 见 [§7.5](#75-缺陷-5-混合检索)

---

### 缺陷 #6：Embedding 与 VectorStore 架构混乱

**严重程度：🟡 P1**

**现状：**

存在两套向量存储体系：

| 服务 | 存储 | 用途 | 状态 |
|------|------|------|------|
| `VectorStoreService` | MemoryVectorStore (进程内) | `/api/embedding/*` 端点 | 孤立模块 |
| `SearchService` | pgvector (数据库) | `AdvancedAnalysisService` 使用 | 实际在用 |

`VectorStoreService` 是一个完整的独立模块（embedding + memory store + 延迟初始化），但它只被 `/api/embedding/*` 端点使用，从未在分析链路中调用。而实际 RAG 流程使用的是 `SearchService` + `EmbeddingService.embedQuery()`。

这造成：
1. 代码冗余：两套向量存储逻辑、两套初始化
2. 内存浪费：`VectorStoreService` 常驻内存但从未用于实际检索
3. 一致性风险：MemoryVectorStore 和 pgvector 中的数据可能不一致

同时，`EmbeddingService` 使用本地 `@xenova/transformers` 模型，每次 `embedQuery()` 都是同步计算——在大文档场景下，这会成为瓶颈（缺少 batch embedding 优化）。

**实现方案：** 见 [§7.6](#76-缺陷-6-embedding--vectorstore-架构统一)

---

### 缺陷 #7：缺少结构化日志与分布式追踪

**严重程度：🟡 P1**

**现状：**

全代码库使用 `console.log` / `console.error` / `console.warn` 进行日志输出，无结构化日志框架。搜索 `console.log(` 出现 25+ 处，`console.error(` 出现 15+ 处。

以 [pipeline-graph.ts](../services/chat/src/llm/graph/pipeline-graph.ts) 为例：

```typescript
console.log(`[Evaluator] pass=${result.pass}, score=${result.score}, issues=${result.issues.length}`);
console.log(`[Pipeline] 评估未通过 (score=${state.evalScore})，进入反思`);
console.error('[Reflector] 反思失败，终止:', errorMsg);
```

**缺失的能力：**

| 能力 | 现状 |
|------|------|
| 结构化日志 (JSON) | ❌ 全部为非结构化 console.log |
| 分布式追踪 (Tracing) | ❌ 无 OpenTelemetry / LangSmith |
| 请求级 Trace ID | ❌ 无法串联同一请求的多节点日志 |
| 日志级别控制 | ❌ 无 DEBUG/INFO/WARN/ERROR 分级 |
| 日志聚合与搜索 | ❌ 无 ELK/Loki 等集成 |
| 关键指标采集 | ❌ 无 LLM 调用延迟 P50/P95/P99 |
| 异常告警 | ❌ 无 |

对于一个执行 6+ 个 LLM 调用的 Multi-Agent 图，没有 tracing 意味着：当用户报告"分析质量不好"时，开发人员**无法知道是哪个节点出了问题**。只能盲猜。

**实现方案：** 见 [§7.7](#77-缺陷-7-结构化日志与分布式追踪)

---

### 缺陷 #8：缺少 LLM 调用层面的容错与重试

**严重程度：🟡 P1**

**现状：**

各节点有 try/catch 降级，但降级策略是**直接返回 fallback 值**，没有重试：

```typescript
// requirement-analysis-graph.ts extractNode 示例
async function extractNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await extractAgent.invoke({ input: state.input });
    return { extracted: parseJson(raw, EXTRACT_FALLBACK) };
  } catch (err) {
    return {
      extracted: {
        ...EXTRACT_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
```

**缺失的能力：**

| 能力 | 现状 |
|------|:---:|
| 指数退避重试 | ❌ |
| Circuit Breaker（熔断） | ❌ |
| 速率限制（Rate Limiting） | ❌ |
| 超时控制 | ❌ |
| 并发限制 | ❌ |
| 主备模型切换 | ❌ |

例如，在 [experts.ts](../services/chat/src/llm/graph/experts.ts) 的 Supervisor 子图中，4 个专家并行调用同一个模型。如果 API 瞬时过载，4 个调用可能同时失败，全部降级为 fallback。而合理的做法是：重试 3 次 + 指数退避 + 超过半数失败则熔断。

特别危险的是，当前 [requirement-analysis-graph.ts](../services/chat/src/llm/graph/requirement-analysis-graph.ts) 中第 342 行的 `createChatModel()` 调用是**模块顶层**的：

```typescript
const model = createChatModel(); // 模块加载时即初始化
```

虽然 NestJS 的依赖注入会解决生命周期问题，但在 `model.factory.ts` 中，每次调用 `createChatModel()` 都会创建新的模型实例——图中多处调用 `createChatModel()`（ReAct 子图、Critic-Refine 子图等），没有连接池管理。

**实现方案：** 见 [§7.8](#78-缺陷-8-llm-调用容错与重试)

---

### 缺陷 #9：缺少 RAG 质量评估体系

**严重程度：🟠 P2**

**现状：**

**零评估指标。** 代码库中没有：

- RAGAS 框架集成（Faithfulness / Answer Relevance / Context Precision / Context Recall）
- 检索质量离线评估数据集
- 生成质量自动化评估
- A/B 测试基础设施
- 用户反馈采集机制
- 坏案例 (Bad Case) 管理系统

对于 RAG 系统来说，没有评估意味着无法回答以下基本问题：

> "上个月我们改了 chunk 大小从 500 到 1000，检索质量变好了还是变差了？"
> "切换到新 Embedding 模型后，答案准确率有什么变化？"
> "Supervisor 选择不激活 security 专家的场景中，有多少是漏报？"

**实现方案：** 见 [§7.9](#79-缺陷-9-rag-质量评估体系)

---

### 缺陷 #10：缺少输出安全护栏（Guardrails）

**严重程度：🟠 P2**

**现状：**

从用户输入到 LLM 输出，**没有任何安全过滤层**：

| 安全层面 | 现状 |
|---------|:---:|
| 输入注入检测 | ❌ 无 Prompt Injection 检测 |
| 输入敏感信息检测 | ❌ 无 PII 识别 |
| 输出内容过滤 | ❌ 无有害内容/幻觉检测 |
| 输出事实性校验 | ❌ 无 Grounding Check |
| 输入长度限制 | ❌ 仅 `MAX_FILE_SIZE = 10MB` 限制文件上传 |
| API 限流 | ❌ 无 Rate Limiting |

虽然这是一个内部需求分析工具，但一旦对外提供 SaaS 服务或接入客户数据，这些问题会在安全审计中被标记为严重缺陷。

**实现方案：** 见 [§7.10](#710-缺陷-10-输出安全护栏)

---

### 缺陷 #11：文档处理能力不足

**严重程度：🟠 P2**

**现状：**

[document.service.ts](../services/chat/src/document/document.service.ts) + [chunk.service.ts](../services/chat/src/document/chunk.service.ts) 提供了基本的上传→解析→分块→嵌入流程，但存在以下瓶颈：

**11a. 文件格式支持有限：**

| 格式 | 支持 | 备注 |
|------|:---:|------|
| TXT/MD | ✅ | 直接读取 |
| PDF | ✅ | pdf.parser |
| DOCX | ✅ | docx.parser |
| XLSX/CSV | ❌ | 需求分析中大量使用 Excel |
| HTML | ❌ | 网页内容无法直接导入 |
| 图片 (PNG/JPG) | ❌ | 无 OCR / 多模态能力 |

**11b. Chunk 参数硬编码：**

```typescript
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
```

500 字符对于中文来说偏小（约 250-300 个中文字）。对于需求文档这类结构化内容，固定 chunk size 会破坏语义边界。

**11c. 缺少元数据提取：**

文档分块后，每个 chunk 丢失了来源文档的章节标题、页码、作者等结构化元数据。检索时用户只能看到 `[文档1: filename.pdf]`，无法知道内容来自文档的哪一章节。

**11d. 缺乏增量更新策略：**

```typescript
// 删除旧块（重处理场景）
await this.prisma.$executeRawUnsafe(
  `DELETE FROM "DocumentChunk" WHERE "documentId" = $1`,
  documentId,
);
```

文档更新时，全量删除旧块再重新分块+嵌入。这在 100+ 文档时会非常缓慢，且造成短暂的"检索空洞"。

**实现方案：** 见 [§7.11](#711-缺陷-11-文档处理增强)

---

### 缺陷 #12：记忆管理碎片化

**严重程度：🟠 P2**

**现状：**

系统中存在**三套**记忆/历史管理方案，互不连通：

| 方案 | 存储 | 使用场景 | 与主图集成 |
|------|------|---------|:---:|
| `InMemoryChatMessageHistory` | 进程内存 | `RunnableMemoryService` | ❌ |
| `DbChatMessageHistory` | PostgreSQL | `AdvancedAnalysisService` | ✅ (但仅做全量拼接) |
| `MessageService` | PostgreSQL | 原始 CRUD | ✅ |

`RunnableMemoryService` 模块（[runnable-memory.service.ts](../services/chat/src/llm/memory/runnable-memory.service.ts)）包含一套完整的多轮对话 + trimMessages 方案，代码中有明确的注释：

```typescript
// 官方已经废弃这种把历史绑在 runnable 上的方式了
// 真实生产场景中，message 都是存储到数据库里的
```

然而这套"废弃方案"仍然注册了完整的 controller + module，占用 `/api/memory/*` 路由。它和主分析流是**完全平行**的——两者无法共享对话历史。

**实现方案：** 见 [§7.12](#712-缺陷-12-记忆管理统一)

---

### 缺陷 #13：缺少 Prompt 管理与版本控制

**严重程度：🟠 P2**

**现状：**

所有 System Prompt 均是**硬编码字符串常量**，散落在各源文件中：

| Prompt 名称 | 所在文件 | 行数(约) |
|------------|---------|:---:|
| CLASSIFIER_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~20 行 |
| TRIAGE_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~25 行 |
| ANALYSIS_AGENT_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~15 行 |
| ACTOR_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~10 行 |
| CRITIC_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~15 行 |
| REFINE_SYSTEM_PROMPT | requirement-analysis-graph.ts | ~8 行 |
| SUPERVISOR_SYSTEM_PROMPT | experts.ts | ~30 行 |
| FUNCTIONAL_EXPERT_SYSTEM_PROMPT | experts.ts | ~40 行 |
| PERFORMANCE_EXPERT_SYSTEM_PROMPT | experts.ts | ~45 行 |
| SECURITY_EXPERT_SYSTEM_PROMPT | experts.ts | ~45 行 |
| COMPLIANCE_EXPERT_SYSTEM_PROMPT | experts.ts | ~50 行 |
| AGGREGATOR_SYSTEM_PROMPT | experts.ts | ~20 行 |
| PLANNER_SYSTEM_PROMPT | pipeline-graph.ts | ~15 行 |
| EVALUATOR_SYSTEM_PROMPT | pipeline-graph.ts | ~20 行 |
| REFLECTOR_SYSTEM_PROMPT | pipeline-graph.ts | ~20 行 |
| SYSTEM_PROMPT | ui-response.service.ts | ~25 行 |

总计 **16+ 个 Prompt**，约 400+ 行 Prompt 文本。对 Prompt 的任何调整都需要**修改源码、重新构建、重新部署**。没有：

- Prompt 版本管理（无法回滚到上一个版本的 Prompt）
- A/B 测试能力（无法对比两个 Prompt 变体的效果）
- 非开发人员的 Prompt 编辑界面
- Prompt 变更影响评估（改了 extract prompt 后，下游分析质量如何变化？）

**实现方案：** 见 [§7.13](#713-缺陷-13-prompt-管理与版本控制)

---

### 缺陷 #14：缺少模型配置管理与热加载

**严重程度：🟢 P3**

**现状：**

`model.factory.ts` 中的 `createChatModel()` 从 YAML 读取配置，但：

1. YAML 中的 `features.enableStructuredOutput` / `features.enableStreaming` 等开关字段**从未被使用**
2. `maxTokens` 被忽略——所有模型实例均未被传入（构造时缺少该参数的实际使用）
3. `temperature` 被 DeepSeek/OpenAI 使用，但 Anthropic 路径的实例化**不传 temperature**（Anthropic 需要该参数时的行为不一致）
4. 配置加载时机在 NestJS 模块初始化阶段，**不支持热加载**
5. 虽然有 `AgentModelSet` 的模型分级设计，但 modelConfigId（如 `'demo-gpt-4o'`）与实际模型名的映射是硬编码的 demo 值，没有通过配置文件/YAML 关联

**实现方案：** 见 [§7.14](#714-缺陷-14-模型配置管理)

---

### 缺陷 #15：测试覆盖率严重不足

**严重程度：🟠 P2**

**现状：**

测试文件清单：

| 测试文件 | 测试范围 | 类型 |
|---------|---------|------|
| `chapter10-token-economics.spec.ts` | token 估算、裁剪、压缩、agent-model-set、budget | 单元测试 ✅ |
| `requirement.spec.ts` | `/requirement/extract` 端点 | E2E ✅ |
| `test-tool-calls-format.ts` | JSON 解析工具 | 工具函数 |
| `test-raw-response.ts` | 模型原始响应 | 调试脚本 |

**缺失的测试：**

| 测试类型 | 覆盖情况 |
|---------|:---:|
| Graph 节点单元测试 | ❌ extract、clarify、risk、triage 等无独立单元测试 |
| Graph 集成测试 | ❌ 无端到端的图执行验证 |
| RAG 检索质量测试 | ❌ 无检索准确率/召回率测试 |
| Prompt 回归测试 | ❌ 无 Prompt 变更的前后对比 |
| 并发/负载测试 | ❌ 无 |
| Embedding 一致性测试 | ❌ 无 |
| 多专家并行测试 | ❌ 无 |

Token 经济学模块的测试质量很高（60+ 测试用例），但这恰恰反衬出其他核心模块的测试空白。

**实现方案：** 见 [§7.15](#715-缺陷-15-测试覆盖率)

---

### 缺陷 #16：配置硬编码严重

**严重程度：🟢 P3**

**现状：**

以下关键参数是硬编码的值，无法通过配置/环境变量调整：

| 参数 | 硬编码值 | 所在文件 |
|------|---------|---------|
| CHUNK_SIZE | 500 | chunk.service.ts |
| CHUNK_OVERLAP | 50 | chunk.service.ts |
| MAX_TOOL_ROUNDS | 6 | requirement-analysis-graph.ts |
| MAX_FILE_SIZE | 10MB | document.service.ts |
| ReAct 专家 max rounds | 3-4 | experts.ts |
| Critic-Refine 上限 | 2 | requirement-analysis-graph.ts |
| Reflexion 上限 | 1 | pipeline-graph.ts |
| trimMessages maxTokens | 2000 | runnable-memory.service.ts |
| compressConversation keepRecent | 10 | conversation-compressor.ts |
| compressConversation summaryMaxTokens | 500 | conversation-compressor.ts |
| SSE 清理 cron | `0 */30 * * * *` | sse.service.ts |
| task_events 保留天数 | 30 | sse.service.ts |

**实现方案：** 见 [§7.16](#716-缺陷-16-配置外部化)

---

### 缺陷 #17：Prompt 中的 RAG 上下文未被实际使用

**严重程度：🔴 P0 — 与 #4 紧密相关**

**现状：**

这是最关键的发现之一。在 `AdvancedAnalysisService.analyze()` 中：

1. `searchService.similaritySearch()` 确实被调用，返回检索文档 ✅
2. `retrievedContext` 被构造并传入 `orchestrator.orchestrate()` ✅
3. `orchestrate()` 调用 `runAnalysisGraph(input, retrievedContext)` ✅
4. `runAnalysisGraph()` 将 `retrievedContext` 写入图 State ✅

但是：

- **`retrievedContext` 参数仅用于图 State 初始化，没有任何图节点将其注入到 LLM 调用中**

在 [requirement-analysis-graph.ts](../services/chat/src/llm/graph/requirement-analysis-graph.ts) 中逐个检查：

| 节点 | 是否使用 `retrievedContext` | System Prompt 是否支持上下文注入 |
|------|:---:|:---:|
| triageNode | ❌ | ❌ (prompt 无 `{retrievedContext}` 占位) |
| extractNode | ❌ | ❌ |
| clarifyNode | ❌ | ❌ |
| analysisSubgraphNode | ❌ | ❌ |
| analysisSupervisorNode | ❌ | ❌ |
| riskNode | ❌ | ❌ |
| summarySubgraphNode | ❌ | ❌ |

仅在 ReAct 子图的 `subgraphAgentNode` 中，`state.input` 和 `state.extracted` 被拼入 prompt——但这是从 State 继承的业务字段，而非检索到的文档上下文。

**结论：这是一个系统性的 RAG 集成缺陷。** 检索到的文档被传递到了 State 中，但全图 7 个核心节点都没有读取和使用它。这意味着当前系统本质上是**一个无 RAG 的 Multi-Agent 系统**，检索能力形同虚设。

**实现方案：** 见 [§7.4](#74-缺陷-4-rag-检索集成到图中)

---

## 5. 综合评分

| 评估维度 | 评分 | 说明 |
|---------|:---:|------|
| 架构设计 | ★★★★☆ (4/5) | Supervisor + 多专家 + Pipeline 架构思路正确 |
| 代码质量 | ★★★☆☆ (3/5) | 有降级处理、类型定义清晰，但硬编码较多 |
| 生产就绪度 | ★★☆☆☆ (2/5) | Checkpointer、HITL、RAG 集成三大 P0 缺陷 |
| RAG 完整性 | ★☆☆☆☆ (1/5) | 检索未集成到图、无重排序、无混合检索 |
| 可观测性 | ★☆☆☆☆ (1/5) | 仅有 console.log，无追踪和指标 |
| 可靠性 | ★★☆☆☆ (2/5) | 有降级但无重试、熔断、限流 |
| 安全性 | ★★☆☆☆ (2/5) | 基础认证 + 用户隔离，无线护栏 |
| 测试 | ★★☆☆☆ (2/5) | Token 模块测试好，核心模块测试空 |
| 配置管理 | ★★☆☆☆ (2/5) | 有 YAML 配置但大量硬编码 |
| 文档与规范 | ★★★☆☆ (3/5) | 代码注释详尽，OpenAPI 文档完整 |

**总评：MVP/Demo 级别，距离生产级交付有 6-12 个月的工作量。**

当前系统可以很好地演示"Multi-Agent 需求分析"的概念，但要作为生产级 RAG 系统上线，需要在以下三个方向投入最多：

1. **LangGraph 生产化**（Checkpointer + HITL）
2. **RAG 管线改造**（检索集成到图 + 混合检索 + 重排序）
3. **可观测性与容错**（Tracing + 重试 + 告警）

---

## 6. 改进路线图

### Phase 1：核心阻塞项（P0，预计 4-6 周）

| 编号 | 缺陷 | 优先级 | 工作量 |
|:---:|------|:---:|:---:|
| #1 | Checkpointer 持久化（MemorySaver → PostgresSaver） | P0 | 2-3 天 |
| #2 | HITL（interrupt + Command） | P0 | 1-2 周 |
| #4/#17 | RAG 检索集成到图中 | P0 | 2-3 周 |

**里程碑：** 图状态可持久化、用户可中途介入、检索结果真正影响 LLM 输出。

### Phase 2：生产稳定性（P0/P1，预计 4-6 周）

| 编号 | 缺陷 | 优先级 | 工作量 |
|:---:|------|:---:|:---:|
| #3 | 滑动窗口 + 摘要压缩集成 | P1 | 1-2 周 |
| #5 | 混合检索（BM25 + Vector） | P1 | 1-2 周 |
| #7 | 结构化日志 + 分布式追踪 | P1 | 1-2 周 |
| #8 | LLM 调用容错与重试 | P1 | 1 周 |

**里程碑：** 长对话质量稳定、检索覆盖关键词和语义、请求可追踪、LLM 调用高可用。

### Phase 3：质量与安全（P1/P2，预计 4-8 周）

| 编号 | 缺陷 | 优先级 | 工作量 |
|:---:|------|:---:|:---:|
| #6 | Embedding/VectorStore 架构统一 | P1 | 1 周 |
| #9 | RAG 质量评估体系 | P2 | 2-3 周 |
| #10 | 输出安全护栏 | P2 | 1-2 周 |
| #11 | 文档处理增强 | P2 | 2-3 周 |
| #12 | 记忆管理统一 | P2 | 1-2 周 |

**里程碑：** 检索质量可量化、输出安全可控、支持更多文档格式。

### Phase 4：工程完善（P2/P3，预计 4-6 周）

| 编号 | 缺陷 | 优先级 | 工作量 |
|:---:|------|:---:|:---:|
| #13 | Prompt 管理与版本控制 | P2 | 2-3 周 |
| #14 | 模型配置管理 | P3 | 1 周 |
| #15 | 测试覆盖率提升 | P2 | 2-3 周 |
| #16 | 配置外部化 | P3 | 1 周 |

**里程碑：** Prompt 可管理、配置可调整、测试覆盖率 > 70%。

---

## 7. 每项缺陷的详细实现方案

### 7.1 缺陷 #1：Checkpointer 生产级持久化

**目标：** Graph state 持久化到 PostgreSQL，支持断点恢复和多实例部署。

**实现步骤：**

```
Step 1: 安装 @langchain/langgraph-checkpoint-postgres
Step 2: 创建 PostgresCheckpointer 包装类
Step 3: 在 NestJS 的 onModuleInit 中调用 setup() 建表
Step 4: 替换 getCheckpointer() 的实现
Step 5: 添加定期清理过期 checkpoint 的 cron job
```

**架构示意：**

```typescript
// 新的 postgres-checkpointer.ts
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

let instance: PostgresSaver | null = null;
let pool: Pool | null = null;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!instance) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL 未设置');

    pool = new Pool({ connectionString: url, max: 10 });
    instance = PostgresSaver.fromPool(pool);
    await instance.setup(); // 创建 checkpoints / checkpoint_writes 表
  }
  return instance;
}

export async function closeCheckpointer(): Promise<void> {
  await pool?.end();
  instance = null;
}
```

**NestJS 集成：**

```typescript
// prisma.service.ts 或新的 checkpointer.provider.ts
@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private checkpointer: PostgresSaver | null = null;

  async onModuleInit() {
    this.checkpointer = await getCheckpointer();
  }

  getCheckpointer(): PostgresSaver {
    if (!this.checkpointer) throw new Error('Checkpointer 未初始化');
    return this.checkpointer;
  }

  async onModuleDestroy() {
    await closeCheckpointer();
  }
}
```

**注意事项：**
- PostgresSaver 使用独立的数据库连接池（不应与 Prisma 共享同一 Pool）
- 需设置 checkpoint 过期清理策略（如 7 天前的 checkpoint 自动删除）
- 需要监控 checkpoints 表的增长（活跃会话数 × 平均节点数 × checkpoint 大小）

---

### 7.2 缺陷 #2：人工介入（Human-in-the-Loop）

**目标：** 支持图在特定节点暂停，等待人工输入后从暂停点继续执行。

**实现步骤：**

```
Step 1: 在 clarifyNode 后添加 interrupt()
Step 2: 在 riskNode 对高风险项添加可选 interrupt()
Step 3: 实现 Command resume 逻辑
Step 4: 前端适配：收集用户补充输入 → POST 到 resume 端点
Step 5: 定时任务：清理超时未 resume 的挂起 checkpoint
```

**方案设计：**

```
改造后的图结构 (requirement-analysis-graph.ts):

START → triage
         ├─ analyze → extract → clarify ──(interrupt if needsClarification)──→ analysisSupervisor → risk → summary → END
         ├─ risk_only → risk ──(interrupt if highRiskDetected)──→ summary → END
         ├─ query → queryHandler → END
         └─ chat → END
```

**代码实现：**

```typescript
// requirement-analysis-graph.ts 中修改 clarifyNode
async function clarifyNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await clarifyAgent.invoke({
      input: state.input,
      extracted: JSON.stringify(state.extracted, null, 2),
    });
    const clarified = parseJson(raw, CLARIFY_FALLBACK);

    // 需要澄清时：中断图执行，等待人工输入
    if (clarified.needsClarification && clarified.questions.length > 0) {
      throw new NodeInterrupt({
        message: '需求需要澄清，请回答以下问题',
        questions: clarified.questions,
      });
    }

    return { clarified };
  } catch (err) {
    if (err instanceof NodeInterrupt) throw err;
    return {
      clarified: { ...CLARIFY_FALLBACK, _error: String(err) },
    };
  }
}
```

**前端交互流程：**

```
1. 图执行到 clarifyNode → interrupt() 抛出
2. SSE 推送 { type: 'interrupted', node: 'clarify', data: { questions: [...] } }
3. 前端展示问题表单，用户填写
4. 前端 POST /api/advanced/resume { threadId, resumeData: { userAnswers: {...} } }
5. 服务端：graph.invoke(Command { resume: { userAnswers } }, { configurable: { thread_id: threadId } })
6. 图继续从 clarifyNode 之后执行
```

需要新增的 API：

```
POST /api/advanced/resume
Body: {
  threadId: string,
  resumeData: {
    type: 'clarification' | 'risk_approval' | 'manual_override',
    payload: Record<string, unknown>
  }
}
```

---

### 7.3 缺陷 #3：滑动窗口 + 历史摘要压缩

**目标：** 将 `conversation-compressor` 和 `message-trimmer` 集成到主分析链路中。

**实现步骤：**

```
Step 1: 在 AdvancedAnalysisService 中集成 trim+compress
Step 2: 为 compressor 配置独立的廉价模型（已在 agent-model-set 中定义 compressorModelConfigId）
Step 3: 引入摘要缓存（按月/会话存储已生成的摘要）
Step 4: 摘要存储到 DB（新增 conversation_summaries 表）
Step 5: 摘要在后续对话中注入为 SystemMessage
```

**实现架构：**

```typescript
// AdvancedAnalysisService.analyze() 中的新流程：

async analyze(userId, conversationId, input) {
  // Step 1: 读取历史消息
  const historyMessages = await this.messageService
    .getHistoryAsLangChainMessages(conversationId);

  // Step 2: 裁剪（保留最近 20 条非 system 消息）
  const trimmedMessages = trimMessagesForContext(historyMessages, {
    maxMessages: 20,
  });

  // Step 3: 压缩（如果非 system 消息超过 keepRecent=10）
  const compressorModel = createChatModel({ /* 使用廉价模型 */ });
  const compressedMessages = await compressConversation(
    trimmedMessages,
    compressorModel,
    { keepRecent: 10, summaryMaxTokens: 500 },
  );

  // Step 4: 提取摘要 SystemMessage 并存储
  const summaryMsg = compressedMessages.find(
    m => m instanceof SystemMessage && m.content.startsWith('[对话摘要]')
  );
  if (summaryMsg) {
    await this.saveSummary(conversationId, summaryMsg.content);
  }

  // Step 5: 送入图
  const fullContext = this.buildContext(compressedMessages, retrievedDocs);
  return this.orchestrator.orchestrate(input, fullContext);
}
```

**数据库新增表：**

```prisma
model ConversationSummary {
  id             String   @id @default(uuid())
  conversationId String
  summaryContent String   // 摘要文本
  messageRange   Json     // { fromIndex: 0, toIndex: 15 } 摘要覆盖的消息范围
  tokenCount     Int      // 摘要 token 数
  createdAt      DateTime @default(now())

  @@index([conversationId])
}
```

**设计要点：**
- 摘要采用**增量式**：每次只压缩新增的早期消息，已生成的摘要不重复压缩
- 摘要存储后，下次请求时直接注入而不需要重新调用 LLM
- Compressor 使用廉价模型（deepseek-chat），不增加显著成本

---

### 7.4 缺陷 #4：RAG 检索集成到图中

**目标：** 检索成为图的一个节点，所有下游节点能读取并使用检索结果。

**实现步骤：**

```
Step 1: 新增 retrieveNode（图中第一个节点）
Step 2: 新增 gradeDocumentsNode（检索相关性评分）
Step 3: 新增 transformQueryNode（多轮查询重写）
Step 4: 修改 extractNode/clarifyNode/analysisSupervisorNode 的 System Prompt
Step 5: 在所有下游 prompt 中注入 retrievedContext
```

**改造后的图结构：**

```
START → transformQuery → retrieve → gradeDocuments → triage
                                                          ├─ analyze → extract → clarify → analysisSupervisor → risk → summary → END
                                                          ├─ risk_only → ...
                                                          └─ chat → END
```

**核心实现：**

```typescript
// 新增：检索节点
async function retrieveNode(state: State): Promise<Partial<State>> {
  try {
    // Step 1: 查询重写（将多轮对话中的指代消解）
    const rewrittenQuery = await rewriteQuery(state.input, state.messages);

    // Step 2: 混合检索（语义 + 关键词）
    const semanticResults = await searchService.similaritySearch(
      rewrittenQuery, state.userId, 10
    );
    const keywordResults = await searchService.keywordSearch(
      rewrittenQuery, state.userId, 10
    );

    // Step 3: RRF (Reciprocal Rank Fusion) 融合
    const mergedResults = reciprocalRankFusion(
      semanticResults, keywordResults, { k: 60 }
    );

    return {
      retrievedDocs: mergedResults.slice(0, 10),
      rewrittenQuery,
    };

  } catch (err) {
    return { retrievedDocs: [], _retrievalError: String(err) };
  }
}

// 新增：检索相关性评分节点
async function gradeDocumentsNode(state: State): Promise<Partial<State>> {
  if (!state.retrievedDocs?.length) return {};

  const graderPrompt = `你是一个检索相关性评估器。判断以下文档是否与查询相关...`;
  const gradedDocs = [];

  for (const doc of state.retrievedDocs) {
    const result = await graderModel.invoke([
      new SystemMessage(graderPrompt),
      new HumanMessage(`Query: ${state.rewrittenQuery}\nDocument: ${doc.content}`)
    ]);
    if (result.isRelevant) gradedDocs.push(doc);
  }

  return { retrievedDocs: gradedDocs };
}

// 在所有下游节点中修改 prompt，注入检索结果
// 例如 extractNode:
async function extractNode(state: State): Promise<Partial<State>> {
  const contextStr = state.retrievedDocs?.length
    ? `\n## 参考文档\n${state.retrievedDocs.map((d, i) =>
        `[文档${i+1}: ${d.filename}]\n${d.content}`).join('\n\n')}`
    : '';

  try {
    const raw = await extractAgent.invoke({
      input: state.input,
      context: contextStr,  // 新增参数
    });
    return { extracted: parseJson(raw, EXTRACT_FALLBACK) };
  } catch (err) { /* fallback */ }
}
```

**Prompt 改造示例（EXTRACT_SYSTEM_PROMPT）：**

```
你是一名需求结构化抽取助手。

## 参考文档
以下是从知识库中检索到的相关文档，请结合这些内容进行分析：
{context}

## 任务
从用户输入中提取...
```

---

### 7.5 缺陷 #5：混合检索

**目标：** 结合语义检索（pgvector）和关键词检索（PostgreSQL full-text search），使用 RRF 融合。

**实现步骤：**

```
Step 1: 在 DocumentChunk 表上创建 GIN 索引 + tsvector
Step 2: 实现 keywordSearch() 方法
Step 3: 实现 reciprocalRankFusion() 融合算法
Step 4: 修改 retrieveNode 为混合检索
```

**代码实现：**

```typescript
// search.service.ts 新增方法
async keywordSearch(
  query: string,
  userId: string,
  topK = 10,
): Promise<SearchResult[]> {
  // PostgreSQL full-text search
  const raw = await this.prisma.$queryRawUnsafe<SearchResult[]>(
    `SELECT
      dc.content,
      ts_rank(dc.search_vector, plainto_tsquery('simple', $1)) AS score,
      dc."documentId",
      d.filename,
      dc."chunkIndex"
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE d."userId" = $2
      AND dc.search_vector @@ plainto_tsquery('simple', $1)
    ORDER BY score DESC
    LIMIT $3`,
    query,
    userId,
    topK,
  );
  return raw;
}

// 独立的 RRF 融合函数（纯函数，不依赖外部服务）
function reciprocalRankFusion(
  denseResults: SearchResult[],
  sparseResults: SearchResult[],
  options: { k?: number } = {},
): SearchResult[] {
  const k = options.k ?? 60;
  const scoreMap = new Map<string, { doc: SearchResult; score: number }>();

  // Dense results → RRF
  denseResults.forEach((doc, rank) => {
    scoreMap.set(doc.documentId + ':' + doc.chunkIndex, {
      doc,
      score: 1 / (k + rank + 1),
    });
  });

  // Sparse results → RRF (累加)
  sparseResults.forEach((doc, rank) => {
    const key = doc.documentId + ':' + doc.chunkIndex;
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += 1 / (k + rank + 1);
    } else {
      scoreMap.set(key, { doc, score: 1 / (k + rank + 1) });
    }
  });

  // 排序
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map(item => ({ ...item.doc, score: item.score }));
}
```

**数据库改造（schema.prisma）：**

```prisma
model DocumentChunk {
  id            String   @id @default(uuid())
  documentId    String
  content       String
  chunkIndex    Int
  embedding     Unsupported("vector")
  -- 新增：全文搜索向量
  searchVector  Unsupported("tsvector")?

  document Document @relation(...)
}
```

需要在 `chunk.service.ts` 的分块处理流程中添加 `search_vector` 的生成。

---

### 7.6 缺陷 #6：Embedding / VectorStore 架构统一

**目标：** 移除 MemoryVectorStore，统一使用 pgvector 作为唯一向量存储。

**实现步骤：**

```
Step 1: 废弃 VectorStoreService（删除或标记 @deprecated）
Step 2: 删除 EmbeddingModule 中的 VectorStoreService 引用
Step 3: 保留 EmbeddingService 作为纯 Embedding 计算层
Step 4: 所有向量操作通过 SearchService (pgvector) 进行
Step 5: 清理 /api/embedding/* 端点，移除非 RAG 主链路的相关 API
```

**改造范围较小，主要是清理冗余代码，约 1 周工作量。**

---

### 7.7 缺陷 #7：结构化日志与分布式追踪

**目标：** 每条请求可追踪全链路，每个 LLM 调用可观测。

**推荐技术方案：** OpenTelemetry + Winston/Morgan（结构化日志）+ LangSmith（或自建 tracing）

**实现步骤：**

```
Step 1: 引入 NestJS Logger（替换所有 console.log）
Step 2: 实现 TraceId 中间件（自动注入 x-trace-id header）
Step 3: 所有图节点输出结构化日志（JSON 格式）
Step 4: 集成 LangSmith Callback（自动捕获 LLM 调用 tracing）
Step 5: 关键指标接入 Prometheus + Grafana
```

**日志规范：**

```typescript
// 替换前
console.log(`[Extract] 抽取完成: ${JSON.stringify(result)}`);

// 替换后
this.logger.log({
  event: 'node_completed',
  graph: 'requirement-analysis',
  node: 'extract',
  traceId: state.traceId,
  threadId: state.threadId,
  duration: Date.now() - startTime,
  hasOutput: !!result,
}, 'Extract node completed');
```

**关键指标（需接入仪表盘）：**

| 指标 | 类型 | 说明 |
|------|------|------|
| `llm_call_latency_ms` | Histogram | LLM 调用延迟 P50/P95/P99 |
| `llm_call_total` | Counter | LLM 调用总数（按模型/节点分组） |
| `llm_call_errors_total` | Counter | LLM 调用错误数 |
| `graph_execution_duration_s` | Histogram | 图执行总耗时 |
| `retrieval_document_count` | Gauge | 每次检索返回的文档数 |
| `checkpoint_size` | Gauge | 当前活跃的 checkpoint 数量 |
| `token_cost_total_usd` | Counter | 累计 Token 成本 |

---

### 7.8 缺陷 #8：LLM 调用容错与重试

**目标：** LLM 调用具备指数退避重试、熔断机制、速率限制。

**实现步骤：**

```
Step 1: 在 model.factory.ts 中，为所有模型实例统一配置 maxRetries
Step 2: 实现 CircuitBreaker（使用 opossum 库或自实现）
Step 3: 实现 RateLimiter（基于 bottleneck 库或令牌桶算法）
Step 4: 并发控制：限制并行 LLM 调用的最大数量
Step 5: 实现主备模型切换（primary 失败 → fallback）
```

**核心实现：**

```typescript
// llm/retry/circuit-breaker.ts
import CircuitBreaker from 'opossum';

interface LLMCallOptions {
  modelName: string;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

class LLMCircuitBreaker {
  private breakers = new Map<string, CircuitBreaker>();

  getBreaker(modelName: string): CircuitBreaker {
    if (!this.breakers.has(modelName)) {
      this.breakers.set(modelName, new CircuitBreaker(
        async (fn: () => Promise<unknown>) => fn(),
        {
          timeout: 30_000,        // 30s 超时
          errorThresholdPercentage: 50, // 50% 失败率触发熔断
          resetTimeout: 30_000,   // 30s 后半开尝试
          rollingCountTimeout: 60_000,
          rollingCountBuckets: 10,
        }
      ));
    }
    return this.breakers.get(modelName)!;
  }
}

export const llmCircuitBreaker = new LLMCircuitBreaker();

// 包装函数：withRetry + withCircuitBreaker + withTimeout
export async function callLLMWithResilience<T>(
  modelName: string,
  fn: () => Promise<T>,
  options: LLMCallOptions = {},
): Promise<T> {
  const breaker = llmCircuitBreaker.getBreaker(modelName);

  return breaker.fire(async () => {
    let lastError: Error | null = null;
    const maxRetries = options.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries) {
          const delay = (options.baseDelayMs ?? 1000) * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  });
}
```

---

### 7.9 缺陷 #9：RAG 质量评估体系

**目标：** 建立可量化的检索质量和生成质量评估体系。

**实现步骤：**

```
Step 1: 构建评估数据集（50-100 个标注的 QA 对 + 相关文档集）
Step 2: 引入 RAGAS 框架进行自动化评估
Step 3: 建立定期评估 pipeline（CI 中每日运行）
Step 4: 建立 Bad Case 收集与管理系统
Step 5: 核心指标可视化
```

**评估维度：**

| 维度 | 指标 | 说明 |
|------|------|------|
| 检索质量 | Context Precision | 检索到的文档中有多少是相关的 |
| 检索质量 | Context Recall | 相关文档中有多少被检索到了 |
| 生成质量 | Faithfulness | 生成的答案是否完全基于检索到的文档 |
| 生成质量 | Answer Relevance | 生成的答案是否与问题相关 |
| 端到端 | Answer Correctness | 答案的事实准确性 |

**实现示例：**

```typescript
// eval/ragas-evaluator.ts
import { evaluate } from 'ragas';

interface EvalSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

async function evaluateRAGQuality(samples: EvalSample[]) {
  const result = await evaluate(
    samples.map(s => ({
      question: s.question,
      answer: s.answer,
      contexts: s.contexts,
      ground_truth: s.ground_truth,
    })),
    [
      'faithfulness',
      'answer_relevancy',
      'context_precision',
      'context_recall',
    ],
  );

  return result; // { faithfulness: 0.85, answer_relevancy: 0.92, ... }
}
```

---

### 7.10 缺陷 #10：输出安全护栏

**目标：** 输入注入防护 + 输出内容过滤。

**实现步骤：**

```
Step 1: 引入 guardrails-ai 或自实现简单的规则引擎
Step 2: 在 triageNode 之前增加 inputGuardNode
Step 3: 在 summaryNode 之后增加 outputGuardNode
Step 4: PII 检测（通过正则 + 预设规则）
Step 5: 敏感操作审计日志
```

**架构设计：**

```typescript
// guardrails/input-guard.ts
async function inputGuardNode(state: State): Promise<Partial<State>> {
  const checks = [
    checkPromptInjection(state.input),  // 检测越狱攻击
    checkPII(state.input),              // 检测 PII
    checkLength(state.input, 10000),    // 长度限制
  ];

  const violations = checks.filter(c => c.violated);

  if (violations.length > 0) {
    return {
      inputBlocked: true,
      blockReason: violations.map(v => v.reason).join('; '),
    };
  }

  return { inputBlocked: false };
}

// guardrails/output-guard.ts
async function outputGuardNode(state: State): Promise<Partial<State>> {
  const checks = [
    checkHallucination(state.summary, state.retrievedDocs), // 幻觉检测
    checkSensitiveContent(state.summary),                    // 敏感内容
    checkFormatting(state.summary),                          // 格式检查
  ];

  // 轻微问题 → 标记警告；严重问题 → 截断/替换
  // ...
}
```

---

### 7.11 缺陷 #11：文档处理增强

**目标：** 支持更多格式、语义分块、元数据保留、增量更新。

**实现步骤：**

```
Step 1: 新增 XLSX/CSV/HTML 解析器
Step 2: 引入 Semantic Chunking（基于 embedding 相似度断点分块）
Step 3: 分块时保留元数据（章节标题、页码、所属文档名）
Step 4: 实现增量更新（只重新处理变更的块）
Step 5: 参数外部化（CHUNK_SIZE / OVERLAP 通过配置注入）
```

**增量更新核心思路：**

```typescript
// 比较新旧文档的 hash 值
async function incrementalUpdate(docId: string, newText: string) {
  const oldHash = await getDocumentHash(docId);
  const newHash = hashText(newText);

  if (oldHash === newHash) return { updated: 0, skipped: existingChunks };

  // 重分块
  const newChunks = await chunkText(newText);

  // Diff: 找出变化和新增的块
  const { toDelete, toInsert, toKeep } = diffChunks(oldChunks, newChunks);

  // 仅删除变化的块
  await deleteChunks(docId, toDelete);

  // 仅嵌入新增的块
  await embedAndInsert(docId, toInsert);

  return { updated: toInsert.length, skipped: toKeep.length };
}
```

---

### 7.12 缺陷 #12：记忆管理统一

**目标：** 以 `DbChatMessageHistory` + PostgreSQL 为唯一方案，废弃内存方案。

**实现步骤：**

```
Step 1: 将 RunnableMemoryService 标记为 @deprecated
Step 2: 在 AdvancedAnalysisService 中集成 trim + compress
Step 3: 删除 MemoryModule 的注册
Step 4: 清理 /api/memory/* 路由
Step 5: 新增 ConversationSummary model，支持摘要持久化
```

---

### 7.13 缺陷 #13：Prompt 管理与版本控制

**目标：** Prompt 集中管理、支持版本和 A/B 测试。

**推荐方案：** 短期（Prompt 表），长期（Prompt CMS / LangSmith Hub）。

**短期实现：**

```prisma
model PromptTemplate {
  id          String   @id @default(uuid())
  name        String   @unique   // e.g. "extract_system_v2"
  version     Int                 // e.g. 2
  content     String              // Prompt 文本
  variables   Json                // ["input", "context", "extracted"]
  status      String   @default("draft") // draft / active / deprecated
  modelConfig String?             // 关联的模型配置
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([name, version])
}

model PromptABTest {
  id            String   @id @default(uuid())
  promptName    String
  variantAId    String   // → PromptTemplate.id
  variantBId    String   // → PromptTemplate.id
  trafficSplit  Int      @default(50)  // A 的比例
  startAt       DateTime
  endAt         DateTime?
  metrics       Json?    // {"variantA": {"accuracy": 0.9}, ...}
}
```

---

### 7.14 缺陷 #14：模型配置管理

**目标：** 模型配置集中管理、支持运行时切换。

**实现步骤：**

```
Step 1: 废弃 langchain.yaml 中的 features 开关（目前未使用）
Step 2: 创建 ModelConfig 数据库表
Step 3: model.factory.ts 从 ModelConfig 表读取配置
Step 4: 实现配置缓存（Redis / 进程内，TTL 60s）
Step 5: 提供 /api/admin/model-configs CRUD API
```

```prisma
model ModelConfig {
  id              String   @id @default(uuid())
  configKey       String   @unique  // e.g. "demo-gpt-4o"
  provider        String             // openai / anthropic / deepseek
  modelName       String             // gpt-4o / claude-sonnet-4-20250514
  temperature     Float    @default(0)
  maxTokens       Int      @default(4096)
  priority        Int      @default(0)  // 优先级（降级选择时参考）
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  tokenUsages     TokenUsage[]
}
```

---

### 7.15 缺陷 #15：测试覆盖率

**目标：** 核心模块测试覆盖率 > 70%。

**实现步骤：**

```
Step 1: 图节点单元测试（mock LLM，测试状态转换逻辑）
Step 2: 图集成测试（使用 fake LLM，测试完整图执行）
Step 3: 检索质量测试（使用标注数据集）
Step 4: Prompt 回归测试（快照测试）
Step 5: 在 CI 中跑全量测试
```

**测试分层：**

| 层级 | 工具 | 覆盖目标 |
|------|------|---------|
| 单元测试 (graph nodes) | bun:test + mock LLM | 所有图节点的状态转换 |
| 集成测试 (full graph) | FakeLLM / TestHarness | 图的路径覆盖 |
| RAG 质量测试 | RAGAS + 标注数据 | 检索/生成质量指标 |
| Prompt 回归测试 | Snapshot + diif | Prompt 变更影响 |
| E2E 测试 | supertest | API 端点可用性 |

---

### 7.16 缺陷 #16：配置外部化

**目标：** 所有硬编码参数通过环境变量或配置文件注入。

**实现方式：**

```typescript
// config/chat.config.ts
export const chatConfig = () => ({
  chunk: {
    size: parseInt(process.env['CHUNK_SIZE'] ?? '500', 10),
    overlap: parseInt(process.env['CHUNK_OVERLAP'] ?? '50', 10),
  },
  graph: {
    maxToolRounds: parseInt(process.env['MAX_TOOL_ROUNDS'] ?? '6', 10),
    maxRefineRounds: parseInt(process.env['MAX_REFINE_ROUNDS'] ?? '2', 10),
    maxReflectionRounds: parseInt(process.env['MAX_REFLECTION_ROUNDS'] ?? '1', 10),
  },
  context: {
    maxMessages: parseInt(process.env['MAX_MESSAGES'] ?? '20', 10),
    keepRecent: parseInt(process.env['KEEP_RECENT'] ?? '10', 10),
    summaryMaxTokens: parseInt(process.env['SUMMARY_MAX_TOKENS'] ?? '500', 10),
  },
  storage: {
    maxFileSize: parseInt(process.env['MAX_FILE_SIZE'] ?? String(10 * 1024 * 1024), 10),
    sseRetentionDays: parseInt(process.env['SSE_RETENTION_DAYS'] ?? '30', 10),
  },
});
```

在 NestJS 中通过 `ConfigModule.forRoot({ load: [chatConfig] })` 注册。

---

## 附录 A：文件清单

已审阅的全部核心文件：

```
services/chat/src/llm/graph/
├── postgres-checkpointer.ts         (77 行)
├── pipeline-graph.ts                (779 行)
├── requirement-analysis-graph.ts    (1756 行)
├── experts.ts                       (1156 行)
├── agents/
│   ├── orchestrator.service.ts      (284 行)
│   └── sub-agents.ts                (55 行)
├── advanced-analysis.service.ts     (204 行)
├── advanced.controller.ts           (data needed)
├── context/
│   ├── conversation-compressor.ts   (128 行)
│   └── message-trimmer.ts           (172 行)
├── cost/
│   ├── token-usage.service.ts       (230 行)
│   ├── token-estimator.ts           (data needed)
│   ├── budget-policy.ts             (data needed)
│   ├── with-token-usage.ts          (data needed)
│   └── agent-model-set.ts           (data needed)
├── embedding/
│   ├── embedding.service.ts         (data needed)
│   └── vector-store.service.ts      (data needed)
├── memory/
│   ├── runnable-memory.service.ts   (182 行)
│   ├── memory.controller.ts         (data needed)
│   └── memory.module.ts             (data needed)
├── message/
│   ├── db-chat-history.ts           (66 行)
│   ├── message.service.ts           (data needed)
│   └── message.module.ts            (data needed)
├── ui-protocol/
│   ├── ui-flow.service.ts           (291 行)
│   ├── ui-response.service.ts       (data needed)
│   └── ui-schemas.ts                (data needed)
├── model.factory.ts                 (data needed)
├── llm.service.ts                   (258 行)
├── requirement.service.ts           (data needed)
├── tools/
│   ├── basic.tools.ts               (data needed)
│   └── business.tools.ts            (data needed)
├── sse/
│   └── sse.service.ts               (data needed)
├── document/
│   ├── document.service.ts          (data needed)
│   ├── chunk.service.ts             (data needed)
│   └── search.service.ts            (data needed)
└── prisma/
    └── schema.prisma                (data needed)
```

---

## 附录 B：术语对照

| 缩写/术语 | 全称 |
|----------|------|
| HITL | Human-in-the-Loop（人工介入） |
| RAG | Retrieval-Augmented Generation（检索增强生成） |
| RRF | Reciprocal Rank Fusion（倒数排名融合） |
| BM25 | Best Match 25（关键词检索算法） |
| PII | Personally Identifiable Information（个人身份信息） |
| RAGAS | RAG Assessment（RAG 质量评估框架） |
| SSE | Server-Sent Events（服务器推送事件） |

---

> **文档版本：** v1.0
> **下次评估建议时间：** Phase 1 完成后（预计 2026-09）
