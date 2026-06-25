# SSE 服务端推送机制详解

## 1. 什么是 SSE

**SSE = Server-Sent Events**，中文叫"服务端推送事件"。

普通 HTTP 请求是"请求→响应→关闭连接"，只有前端能主动问后端要数据。

SSE 则是"前端建立连接→连接一直保持→后端随时可以推数据给前端"。方向是单向的（服务端→客户端），就像一条从服务器通往前端的单向管道。

```
普通 HTTP：
  前端 ──请求──► 后端
  前端 ◄──响应── 后端
  连接关闭

SSE：
  前端 ──GET /api/sse/tasks──► 后端
  连接保持……
  前端 ◄──data: { status: "processing" }── 后端 （后端主动 push）
  连接保持……
  前端 ◄──data: { status: "done" }── 后端 （后端主动 push）
  连接保持……
```

## 2. SSE 的完整生命周期

用一次"上传 PDF 文档并处理"来演示整个过程：

### 2.1 建立连接

用户打开页面时，前端调用：

```typescript
// 前端代码（Js）
const eventSource = new EventSource("http://localhost:4001/api/sse/tasks", {
  headers: { Authorization: "Bearer <token>" }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("收到事件:", data);
};
```

此时浏览器发起一个 `GET /api/sse/tasks` 请求，携带 `Authorization` 头。

### 2.2 后端注册连接

```typescript
// services/chat/src/sse/sse.controller.ts

@Get("tasks")
@UseGuards(AuthGuard)
async streamTasks(@Req() req: Request, @Res() res: Response) {
  const userId = this.getUserId(req); // 从 JWT 中提取 userId = "user-123"

  // 1. 设置 SSE 协议头——告诉浏览器"这不是一次性的 HTTP 响应，而是一个流"
  res.writeHead(200, {
    "Content-Type": "text/event-stream", // 关键：告诉浏览器这是 SSE 流
    "Cache-Control": "no-cache",        // 禁用缓存
    Connection: "keep-alive",            // 保持连接
  });

  // 2. 发送初始确认
  res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

  // 3. 把这个连接注册到 SseService 的连接池里
  this.sseService.addConnection(userId, res);

  // 4. 每 30 秒发一个心跳注释行，防止 Nginx/代理 把空闲连接断掉
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");  // 以 ":" 开头的是 SSE 注释，前端会忽略
  }, 30_000);

  // 5. 客户端断开时（关 Tab / 网络断）自动清理
  req.on("close", () => {
    clearInterval(heartbeat);
    this.sseService.removeConnection(userId, res);
  });

  // 注意：这里不调用 res.end()，连接永久保持打开状态
}
```

### 2.3 连接池设计：`Map<userId, Set<Response>>`

```typescript
// services/chat/src/sse/sse.service.ts

// 数据结构：
//
//   "user-123" → { Response#1, Response#2, Response#3 }  ← 用户开了 3 个 Tab
//   "user-456" → { Response#4 }                          ← 用户开了 1 个 Tab

private readonly connections = new Map<string, Set<Response>>();

addConnection(userId: string, res: Response) {
  if (!this.connections.has(userId)) {
    this.connections.set(userId, new Set());
  }
  this.connections.get(userId)!.add(res);
}

removeConnection(userId: string, res: Response) {
  const set = this.connections.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    this.connections.delete(userId);  // 用户所有 Tab 都关了，清空这个用户
  }
}
```

为什么用 `Set<Response>` 而不是单个 `Response`？因为同一个用户可能打开多个浏览器 Tab，每个 Tab 有自己的 SSE 连接。当一个文档处理完成时，**所有** Tab 都应该收到通知。

### 2.4 后端推送事件

用户在页面上传了一个 PDF 文件，提交处理请求，后端开始处理。

```typescript
// services/chat/src/document/chunk.service.ts

async processDocument(documentId: string, userId: string) {
  // ① 开始处理 → 立即推送状态
  await this.sse.emit(userId, {
    taskId: documentId,
    taskType: "document_process",
    status: TaskStatus.processing,
    message: "文档处理中…",
    metadata: { filename: "产品手册.pdf" },
  });

  try {
    // ② 解析、分块、向量化…（耗时操作）
    const text = await extractText(doc.filePath, doc.mimeType);
    const chunks = await this.splitter.splitText(text);
    // ...

    // ③ 完成 → 推送完成事件
    await this.sse.emit(userId, {
      taskId: documentId,
      taskType: "document_process",
      status: TaskStatus.done,
      message: "文档处理完成，共 32 个块",
      metadata: { filename: "产品手册.pdf", chunkCount: 32 },
    });
  } catch (err) {
    // ④ 失败 → 推送失败事件
    await this.sse.emit(userId, {
      taskId: documentId,
      taskType: "document_process",
      status: TaskStatus.error,
      message: err.message,
      metadata: { filename: "产品手册.pdf" },
    });
  }
}
```

`emit()` 方法做了两件事：

```typescript
async emit(userId: string, payload: TaskEventPayload) {
  // ① 持久化到数据库（task_events 表），用户离线后再上线也能查到历史
  const event = await this.prisma.taskEvent.create({
    data: {
      userId,
      taskType: payload.taskType,
      taskId: payload.taskId,
      status: payload.status,
      message: payload.message,
      metadata: payload.metadata,
    },
  });

  // ② 实时推送给该用户的所有在线连接（所有 Tab）
  const data = JSON.stringify({ ... });
  const connections = this.connections.get(userId);
  if (connections) {
    for (const res of connections) {
      try {
        res.write(`data: ${data}\n\n`);  // SSE 标准格式
      } catch {
        this.removeConnection(userId, res);  // 连接已断，自动清理
      }
    }
  }
}
```

### 2.5 前端断开连接

用户关闭 Tab 时：

1. 浏览器自动关闭 EventSource 连接
2. Node.js 触发 `req.on("close")`
3. `removeConnection()` 从 `Set<Response>` 中移除这个连接
4. 如果这是该用户最后一个 Tab，整个用户从 Map 中清空

### 2.6 定时清理

```typescript
// services/chat/src/sse/sse.service.ts

@Cron("0 */30 * * * *")  // 每 30 分钟执行一次
async handleCronCleanup() {
  // ① 清理已被销毁但未正确移除的 Response 对象
  for (const [userId, set] of this.connections.entries()) {
    for (const res of set) {
      if (res.destroyed) set.delete(res);
    }
    if (set.size === 0) this.connections.delete(userId);
  }

  // ② 删除 30 天前的历史任务事件（避免表膨胀）
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await this.prisma.taskEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}
```

## 3. 双重保障：持久化 + 实时推送

SSE 只能推送给**当前在线**的用户。如果用户关浏览器了，事件就收不到了。

所以 `emit()` 做了两件事：**先存数据库，再实时推送**。

```
emit(userId, event)
  │
  ├── 持久化到 task_events 表  （用户离线后也能查）
  │
  └── 推送给所有在线连接        （实时通知当前在线的用户）
```

离线用户下次打开页面时，可以调 `GET /api/tasks/history` 拉取历史任务记录。

## 4. 任务历史查询

```typescript
// GET /api/tasks/history?page=1&pageSize=20
async getHistory(userId: string, page = 1, pageSize = 20) {
  const [items, total] = await Promise.all([
    this.prisma.taskEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    this.prisma.taskEvent.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize };
}
```

前端可以做一个"任务通知中心"，把未读数量显示为小红点。

```typescript
// PATCH /api/tasks/:taskId/read
async markRead(taskId: string, userId: string) {
  await this.prisma.taskEvent.updateMany({
    where: { taskId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}
```

## 5. Complete Business Scenario

假设用户 `user-123` 上传了三份 PDF 文档到系统，然后依次点击"开始处理"：

```
时间线
────────────────────────────────────────────────────────────

T1: 用户打开 Tab1、Tab2（两个 SSE 连接都已建立）
      connections: { "user-123" → { Res1, Res2 } }

T2: Tab1 上传 fileA.pdf，点"处理"
      后端处理中 → emit(user-123, { taskId: "fileA", status: "processing" })
      Res1 收到 ✅ → "fileA 处理中…"
      Res2 收到 ✅ → "fileA 处理中…"

T3: Tab1 上传 fileB.pdf，点"处理"
      后端处理中 → emit(user-123, { taskId: "fileB", status: "processing" })
      Res1 收到 ✅ → "fileB 处理中…"
      Res2 收到 ✅ → "fileB 处理中…"

T4: fileA 处理完成
      emit(user-123, { taskId: "fileA", status: "done", chunkCount: 18 })
      Res1 ✅、Res2 ✅ → "fileA 处理完成，共 18 个块"

T5: fileB 处理失败（文件损坏）
      emit(user-123, { taskId: "fileB", status: "error", message: "无法解析" })
      Res1 ✅、Res2 ✅ → "fileB 处理失败"

T6: 用户关闭 Tab2
      removeConnection("user-123", Res2)
      connections: { "user-123" → { Res1 } }
```

## 6. SSE vs WebSocket vs Polling

| | SSE | WebSocket | 轮询 |
|------|-----|-----------|------|
| 方向 | 服务端 → 客户端（单向） | 双向 | 客户端 → 服务端（单向） |
| 协议 | 基于 HTTP（兼容所有代理） | 独立协议 ws:// | HTTP |
| 实现复杂度 | 极低（原生 EventSource） | 需要 ws 库 | 极低 |
| 自动重连 | 浏览器原生支持 | 需手动实现 | 无 |
| 适用场景 | 通知推送、日志流、状态变更 | 实时聊天、游戏 | 少数场景 |
| 本项目用途 | 任务进度通知 + Chat 流式响应 | 未使用 | 未使用 |

**本项目为什么选择 SSE 而不是 WebSocket：**

1. 只需要服务端推给客户端，客户端不需要主动推给服务端（WebSocket 浪费了双向能力）
2. SSE 基于 HTTP，天然兼容所有负载均衡器、代理、防火墙，WebSocket 有额外的协议升级过程（101 Switching Protocols）
3. 浏览器 `EventSource` 自带自动重连，断网恢复后自动重连，不用写代码
4. 复杂度更低——控制器返回一个流就行，不需要维护 WebSocket 的 `ping/pong` 心跳

## 7. 关键术语

| 术语 | 解释 |
|------|------|
| **SSE** | Server-Sent Events，服务端到客户端的单向推送协议 |
| **text/event-stream** | SSE 的 MIME 类型，告诉浏览器"即将收到流数据" |
| **心跳 (Heartbeat)** | 注释行 `: heartbeat\n\n`，防止代理服务器把空闲连接断开 |
| **@Cron** | NestJS Schedule 调度器，支持标准 cron 表达式 |
| **EventSource** | 浏览器原生 SSE 客户端，一行 `new EventSource(url)` 即可连接 |
| **`res.write()`** | 分块写数据，不关闭连接，与 `res.end()` 互斥 |
| **持久化** | 事件同时写入数据库 `task_events` 表，保证离线用户可追溯 |
