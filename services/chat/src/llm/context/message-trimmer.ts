// ---------------------------------------------------------------
// 10.5.1 消息裁剪工具（message-trimmer）
//
// 用途：在送入 LLM 之前裁剪 messages 数组，控制每个 Agent
// 节点的上下文长度。配合 conversation-compressor 使用：
// "先裁剪、再压缩"，调用顺序由使用方控制。
//
// 核心策略：
// 1. SystemMessage 单独保留（不被裁剪丢弃）
// 2. 非 system 消息取最近 maxMessages 条
// 3. 裁剪后执行 removeOrphanToolMessages 清理孤立的
//    ToolMessage（避免 OpenAI/Anthropic 因 tool_calls
//    部分缺失响应而拒绝请求）
// ---------------------------------------------------------------

import {
  AIMessage,
  BaseMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

export interface TrimOptions {
  /** 保留的非 system 消息最大条数，默认 20 */
  maxMessages?: number;
  /** 是否始终保留 SystemMessage，默认 true */
  preserveSystemMessages?: boolean;
}

// ---------------------------------------------------------------
// removeOrphanToolMessages
// ---------------------------------------------------------------

/**
 * 按 tool_call_id 精确配对，采用"全有或全无"策略清理孤立的
 * AIMessage(tool_calls) 与 ToolMessage。
 *
 * 算法（三遍扫描）：
 *
 * Pass 1 — 收集窗口中所有 ToolMessage.tool_call_id：
 *   respondedToolCallIds = { t1, t2, … }
 *
 * Pass 2 — 判定每条 AIMessage(tool_calls) 是否幸存：
 *   仅当该 AIMessage 的 **每一个** tool_call.id 都存在于
 *   respondedToolCallIds 中时，该 AIMessage 幸存，
 *   并将其全部 tool_call.id 加入 survivingToolCallIds。
 *
 * Pass 3 — 组装结果：
 *   - 普通消息直接保留
 *   - AIMessage(tool_calls) 仅幸存者保留
 *   - ToolMessage 仅 tool_call_id ∈ survivingToolCallIds 的保留
 *
 * 这样避免了 AIMessage 的 tool_calls 部分有响应、部分缺失
 * 导致模型拒绝对话的尴尬局面。
 */
export function removeOrphanToolMessages(
  messages: BaseMessage[],
): BaseMessage[] {
  // ---- Pass 1: 收集所有 ToolMessage 的 tool_call_id ----
  const respondedToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      const tid = (msg as ToolMessage).tool_call_id;
      if (tid) {
        respondedToolCallIds.add(tid);
      }
    }
  }

  // ---- Pass 2: 判定每条 AIMessage(tool_calls) 是否幸存 ----
  const survivingToolCallIds = new Set<string>();
  const survivingAIMessages = new Set<AIMessage>();

  for (const msg of messages) {
    if (!(msg instanceof AIMessage)) continue;
    const ai = msg as AIMessage;
    const toolCalls = ai.tool_calls;
    if (!toolCalls || toolCalls.length === 0) continue;

    // 检查：每一个 tool_call.id 是否都有对应的 ToolMessage 响应？
    const allResponded = toolCalls.every(
      (tc) => tc.id != null && respondedToolCallIds.has(tc.id),
    );

    if (allResponded) {
      survivingAIMessages.add(ai);
      for (const tc of toolCalls) {
        if (tc.id) survivingToolCallIds.add(tc.id);
      }
    }
    // 否则整条 AIMessage 被丢弃（连同其 tool_calls 对应的
    // ToolMessages 也会在 Pass 3 被过滤掉 —— 全有或全无）
  }

  // ---- Pass 3: 组装结果 ----
  const result: BaseMessage[] = [];
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      const tid = (msg as ToolMessage).tool_call_id;
      if (tid && survivingToolCallIds.has(tid)) {
        result.push(msg);
      }
      // 不在 survivingToolCallIds 中的 ToolMessage 被丢弃
    } else if (msg instanceof AIMessage) {
      const ai = msg as AIMessage;
      if (ai.tool_calls && ai.tool_calls.length > 0) {
        // 带 tool_calls 的 AIMessage：仅幸存者保留
        if (survivingAIMessages.has(ai)) {
          result.push(msg);
        }
      } else {
        // 不带 tool_calls 的普通 AIMessage 直接保留
        result.push(msg);
      }
    } else {
      // HumanMessage / SystemMessage 等直接保留
      result.push(msg);
    }
  }

  return result;
}

// ---------------------------------------------------------------
// trimMessagesForContext
// ---------------------------------------------------------------

/**
 * 裁剪消息列表，控制上下文长度。
 *
 * 行为：
 * 1. 抽出全部 SystemMessage 单独保留（或根据
 *    preserveSystemMessages 决定）
 * 2. 对剩余消息取最近 maxMessages 条
 * 3. 调用 removeOrphanToolMessages 清理工具消息
 * 4. 拼回 [system…, 清理后]
 */
export function trimMessagesForContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  const maxMessages = options.maxMessages ?? 20;
  const preserveSystemMessages = options.preserveSystemMessages ?? true;

  // 分离 SystemMessage 与其余消息
  const systemMessages: BaseMessage[] = [];
  const nonSystemMessages: BaseMessage[] = [];

  for (const msg of messages) {
    if (msg instanceof SystemMessage) {
      systemMessages.push(msg);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  // 取最近 maxMessages 条非 system 消息
  const trimmed = nonSystemMessages.slice(-maxMessages);

  // 清理孤立的 ToolMessage / AIMessage(tool_calls)
  const cleaned = removeOrphanToolMessages(trimmed);

  // 拼回
  if (preserveSystemMessages) {
    return [...systemMessages, ...cleaned];
  }
  return cleaned;
}
