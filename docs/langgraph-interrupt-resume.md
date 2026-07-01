# LangGraph Interrupt / Resume 机制

## 概述

LangGraph 原生的 `interrupt` / `Command` 机制允许在图的执行过程中**暂停并等待人工干预**，然后从断点恢复继续执行。适用于需求澄清、风险审批、冲突确认等需要人机交互的场景。

---

## 核心 API

| API | 作用 |
|-----|------|
| `interrupt(data: any)` | 暂停当前图执行，将 State 写入 checkpointer，抛出 `GraphInterrupt` 异常 |
| `Command({ resume: value })` | 作为 `graph.invoke()` 的入参，从指定 thread_id 的断点恢复，`value` 注入到上次 `interrupt()` 处 |
| `MemorySaver` / `PostgresSaver` | 检查点存储，保存和恢复图执行状态 |

---

## 执行模型

### 没有 interrupt 时

```
graph.invoke(input)
  → nodeA  → nodeB  → nodeC  → END
  → invoke() 返回完整 State
```

一次性同步调用，`await graph.invoke()` 阻塞直到全部完成。

### 有 interrupt 时

```
第一次 invoke:
  graph.invoke(input, { thread_id })
    → nodeA 跑完
    → nodeB 中调用 interrupt(data) → 抛 GraphInterrupt
  → catch (err) → isGraphInterrupt(err) === true
  → 返回给前端：{ interrupted: true, interruptData: data }

第二次 invoke:
  graph.invoke(Command({ resume: answer }), { thread_id })
    → 从 checkpointer 恢复 State（nodeA 的结果还在）
    → 重新执行 nodeB（interrupt() 不再抛异常，而是 return answer）
    → nodeC  → END
    → invoke() 返回完整 State
```

---


### interrupt() 的双重语义

`interrupt()` 在同一个 `thread_id` 的生命周期内扮演两种角色：

1. **首次执行**：`throw GraphInterrupt`——暂停，控制权返回调用方
2. **恢复执行**：`return resumeValue`——把 `Command({ resume })` 传入的值作为返回值继续执行

## 同一节点会被重新执行

由于图**保存的是节点粒度**而非代码行粒度，即使节点在中断前执行了 90%，恢复时仍会从头重新执行该节点。

```
clarifyNode(state) {
  // ====== 第一次执行 ======
  const llmResult = await LLM.invoke(...);   // LLM 已调用
  const result = parse(llmResult);
  if (result.needsClarification) {
    interrupt({ questions });                 // ← 这里暂停
    // ====== 以下不会执行 ======
  }
  return { clarified: result };
}

clarifyNode(state) {
  // ====== 恢复后，从头重新执行 ======
  const llmResult = await LLM.invoke(...);   // LLM 再次调用
  const result = parse(llmResult);
  // 这次不会触发 interrupt，因为用户已回答问题
  return { clarified: result };               // ← 正常返回
}
```

换言之，恢复后图中的执行模型是：

| 节点 | 状态 | 行为 |
|------|------|------|
| 中断之前的节点 | checkpointer 中有完整结果 | 跳过，不重新执行 |
| 中断所在的节点 | 未执行到 `return` | 从头重新执行 |
| 中断之后的节点 | 尚未开始 | 正常执行 |

## checkpointer 与 State

`interrupt()` 发生时，LangGraph 将**当前完整 State** 写入 checkpointer，包括：
- 所有节点的输出
- messages 历史
- 工具调用记录
- 自定义字段的值

恢复时，这些数据通过 `{ configurable: { thread_id: 'xxx' } }` 从 checkpointer 中取回，对新创建的图实例**透明可见**。

## 关键数据结构

```
Graph 实例    — 节点的执行配方（DAG 描述），每次请求都可以新建，不影响状态恢复。
Checkpointer  — 全局单例，存储 State 快照，是中断恢复的核心载体。
thread_id     — 隔离单元，同一 thread_id 共享检查点，不同会话天然隔离，通常等于 conversationId。
```

二者之间并没有"同一个 Graph 实例"的硬性要求。中断前后是两个不同的 HTTP 请求以及两次独立的 `graph.invoke()` 调用；将这两次调用串联起来的是同一个 `thread_id` 在 checkpointer 中查找出上一次的运行信息，然后拿该信息在当前新的图实例中，略过已完成的节点，继续执行暂停节点及其后续的剩余节点。

## 后端实现要点

### 1. 图编译时注册 checkpointer

```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver(); // 开发用内存，生产换 PostgresSaver

export function createAnalysisGraph() {
  return new StateGraph(RequirementAnalysisState)
    .addNode(...)
    // ...
    .compile({ checkpointer }); // ← 关键
}
```

### 2. 节点内调用 interrupt

```typescript
async function clarifyNode(state: State) {
  const result = await clarifyAgent.invoke(...);

  if (result.needsClarification && result.questions.length > 0) {
    // 暂停执行，状态写入 checkpointer，抛出 GraphInterrupt
    interrupt({
      type: 'clarification_required',
      questions: result.questions,
    });
    // 注意：下面任何代码都不会执行
  }

  return { clarified: result };
}
```

### 3. 调用方用 try/catch 区分"完成"和"暂停"

```typescript
async function runOrResume(args: {
  input?: string;
  resume?: { answers: string[] };
  threadId: string;
}) {
  const graph = createAnalysisGraph();
  const config = { configurable: { thread_id: args.threadId } };

  // 首次传 { input, messages: [] }，恢复时传 Command({ resume })
  const payload = args.resume
    ? new Command({ resume: args.resume.answers })
    : { input: args.input, messages: [] };

  try {
    const state = await graph.invoke(payload, config);
    // 图正常结束
    return { interrupted: false, report: state.summary };
  } catch (err) {
    if (isGraphInterrupt(err)) {
      // 图暂停了，不是真的错误
      const interruptData = err.interrupts[0].value;
      return { interrupted: true, interruptData, threadId: args.threadId };
    }
    throw err; // 真正的异常继续向上抛
  }
}
```

### 4. Controller 层端点设计

```
POST /api/conversations/:id/chat    → 首次发起对话
POST /api/conversations/:id/resume  → 中断后恢复
```

`thread_id` 与 `conversationId` 一一对应，首次发起时生成并落库，后续从库中读取。

## 前端交互要点

### 首次请求

```typescript
const response = await fetch(`/api/conversations/${convId}/chat`, {
  method: 'POST',
  body: JSON.stringify({ input }),
});
const data = await response.json();

if (data.interrupted) {
  // 弹出对话框，展示 data.interruptData.questions
  // 存储 data.threadId 供恢复时使用
  showPromptDialog(data.interruptData);
} else {
  // 正常展示报告
  showReport(data.report);
}
```

### 恢复请求

```typescript
const response = await fetch(`/api/conversations/${convId}/resume`, {
  method: 'POST',
  body: JSON.stringify({ answers: userAnswers }),
});
const data = await response.json();

if (data.interrupted) {
  // 可能再次中断（连环提醒）
  showPromptDialog(data.interruptData);
} else {
  dismissDialog();
  showReport(data.report);
}
```

## checkpoint 持久化方案

| 方案 | 适用场景 |
|------|---------|
| `MemorySaver` | 开发环境，进程重启后所有中断状态丢失 |
| `PostgresSaver`（官方） | 生产环境，中断状态可跨进程、跨重启保持 |
| 自实现 `BaseCheckpointSaver` | 需要自定义存储逻辑时 |

## 不止是澄清：Human-in-the-loop 扩展场景

`interrupt` 机制的本质是"人机决策点"，可以插入图的任意位置：

| 场景 | 中断节点 | 恢复后行为 |
|------|---------|-----------|
| 需求澄清 | `clarifyNode` | 继续 analysis → risk → summary |
| 风险评估确认 | `riskNode` 检出 critical 风险时 | 用户选择"接受"或"修改约束" |
| 冲突裁决 | `analysisSubgraph` 冲突检测后 | 用户选择保留/合并/覆盖 |
| 审批流转 | 独立的 `approvalNode` | 经理审批后继续部署 |

---

## 要点回顾

1. `interrupt()` 第一次抛 `GraphInterrupt`，第二次（恢复时）自动变成 `return resumeValue`，**节点代码不需要写 `if (isResume)` 分支**
2. 图（Graph）只是配方，状态在 checkpointer 里；两次请求创建不同的图实例，靠同一个 `thread_id` 找回进度
3. 保存的是节点粒度：恢复后已完成的节点跳过，**中断所在的节点从头重新执行**
4. `interrupt()` 被调用的位置决定了"用户介入后需要重新跑哪一部分"，所以应放在**所有不可逆操作之后**
