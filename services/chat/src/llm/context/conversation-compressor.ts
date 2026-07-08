// ---------------------------------------------------------------
// 10.5.2 对话摘要压缩工具（conversation-compressor）
//
// 用途：当 messages 历史过长时，将早期消息用 LLM 压缩成
// 一条摘要 SystemMessage，只保留最近 keepRecent 条原文消息，
// 从而控制送入模型的上下文长度。
//
// 与 message-trimmer 配合使用："先裁剪、再压缩"（调用顺序
// 由使用方控制，本模块不内部调用 trimMessagesForContext）。
//
// 零硬编码 LLM 依赖 —— SummaryModel 由调用方注入，单元测试
// 使用 mock 即可。
// ---------------------------------------------------------------

import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

/**
 * 摘要模型的抽象接口。
 *
 * 调用方注入任意 LLM 实现（ChatOpenAI / ChatAnthropic / mock），
 * 只需提供 invoke 方法即可。
 */
export interface SummaryModel {
  invoke(messages: { role: string; content: string }[]): Promise<{ content: string }>;
}

export interface CompressOptions {
  /** 保留最近 N 条非 system 消息原文，默认 10 */
  keepRecent?: number;
  /** 摘要最大 token 数（软约束，建议值 500），默认 500 */
  summaryMaxTokens?: number;
}

// ---------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------

/**
 * 将 BaseMessage 转为纯 { role, content } 对象，供摘要模型使用。
 */
function toPlainMessage(msg: BaseMessage): { role: string; content: string } {
  const type = msg.getType?.() ?? 'unknown';
  const content =
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return { role: type, content };
}

// ---------------------------------------------------------------
// compressConversation
// ---------------------------------------------------------------

/**
 * 对过长的对话历史进行摘要压缩。
 *
 * 行为：
 * 1. 抽出全部 SystemMessage 单独保留
 * 2. 非 system 消息数 <= keepRecent → 直接返回原 messages
 *    （无需压缩）
 * 3. 否则将早期消息（前 N - keepRecent 条）用 summaryModel
 *    压缩成一条 [对话摘要] 开头的 SystemMessage，
 *    最终返回 [原 system…, 摘要 system, 最近 keepRecent 条]
 *
 * 摘要要求保留：需求编号、功能描述、用户意图、已完成的操作；
 * 总长度 <= summaryMaxTokens。
 */
export async function compressConversation(
  messages: BaseMessage[],
  summaryModel: SummaryModel,
  options: CompressOptions = {},
): Promise<BaseMessage[]> {
  const keepRecent = options.keepRecent ?? 10;
  const summaryMaxTokens = options.summaryMaxTokens ?? 500;

  // Step 1: 分离 SystemMessage
  const systemMessages: BaseMessage[] = [];
  const nonSystemMessages: BaseMessage[] = [];

  for (const msg of messages) {
    if (msg instanceof SystemMessage) {
      systemMessages.push(msg);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  // Step 2: 短对话无需压缩，直接返回
  if (nonSystemMessages.length <= keepRecent) {
    return messages;
  }

  // Step 3: 分割早期 / 近期消息
  const splitIndex = nonSystemMessages.length - keepRecent;
  const earlyMessages = nonSystemMessages.slice(0, splitIndex);
  const recentMessages = nonSystemMessages.slice(splitIndex);

  // Step 4: 构建摘要 prompt 并调用摘要模型
  const summarySystemPrompt = [
    '你是一个对话摘要助手。请将以下多轮对话片段压缩成一段简洁的摘要。',
    '摘要中必须保留以下信息：',
    '- 需求编号（如有）',
    '- 功能描述',
    '- 用户意图',
    '- 已完成的操作',
    `摘要总长度请控制在 ${summaryMaxTokens} tokens 以内。`,
    '只输出摘要文本本身，不要添加任何格式标记或前缀。',
  ].join('\n');

  const summaryInput = [
    { role: 'system', content: summarySystemPrompt },
    ...earlyMessages.map(toPlainMessage),
  ];

  const summaryResult = await summaryModel.invoke(summaryInput);
  const summaryContent = `[对话摘要] ${summaryResult.content}`;

  // Step 5: 组装最终消息列表
  const summaryMessage = new SystemMessage(summaryContent);

  return [...systemMessages, summaryMessage, ...recentMessages];
}
