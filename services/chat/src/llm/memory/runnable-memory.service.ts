import { Injectable, Logger } from '@nestjs/common';
// 官方已经废弃这种把历史绑在 runnable 上的方式了
// 真实生产场景中，message 都是存储到数据库里的（这里只是用于模拟 messageHistory 的工作方式）
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  HumanMessage,
  AIMessage,
  trimMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from '../model.factory';

const SYSTEM_PROMPT = `你是一名需求分析助手。你可以基于多轮对话的上下文，记住用户之前提到过的信息（如需求单号、背景描述、约束条件等），并结合历史记录给出连贯、专业的分析。

要求：
1. 记住用户在前几轮提到的需求编号、背景、角色等信息
2. 在回答时引用之前讨论过的内容
3. 如果用户的问题不完整，基于历史记录尝试推断并指出缺失信息
4. 保持专业、清晰的中文表达`;

/**
 * Memory 服务：封装 RunnableWithMessageHistory + InMemoryChatMessageHistory
 *
 * 提供两个版本：
 * - 基础版（chat）：完整保留所有历史消息
 * - 裁剪版（chatTrimmed）：用 trimMessages 限制上下文窗口（maxTokens: 2000, strategy: 'last'）
 */
@Injectable()
export class RunnableMemoryService {
  private readonly logger = new Logger(RunnableMemoryService.name);

  /** sessionId → InMemoryChatMessageHistory 的映射 */
  private stores = new Map<string, InMemoryChatMessageHistory>();

  private model = createChatModel();

  /** 基础版：完整历史 */
  private readonly chainWithHistory: RunnableWithMessageHistory<
    { input: string },
    string
  >;

  /** 裁剪版：trimMessages(maxTokens: 2000, strategy: 'last') */
  private readonly chainWithTrimmedHistory: RunnableWithMessageHistory<
    { input: string },
    string
  >;

  constructor() {
    // 共用 Prompt 模板：system + history 占位 + human input
    // 这里的 history 其实只是个占位符，此刻他没有任何内容
    // 在当前代码逻辑里，是要在 RunnableWithMessageHistory 时，从 InMemoryChatMessageHistory
    // 中读取历史消息，然后回填到这里
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      new MessagesPlaceholder('history'),
      ['human', '{input}'],
    ]);

    // ---- 基础版 ----
    const baseChain = prompt.pipe(this.model).pipe(new StringOutputParser());

    this.chainWithHistory = new RunnableWithMessageHistory({
      runnable: baseChain,
      // 拿到全部的 history
      getMessageHistory: (sessionId) => this.getOrCreateStore(sessionId),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });

    // ---- 裁剪版（trimMessages 作为链的第一环） ----
    const { model } = this;
    const trimmedChain = prompt.pipe(this.model).pipe(new StringOutputParser());

    this.chainWithTrimmedHistory = new RunnableWithMessageHistory({
      runnable: trimmedChain,
      // 拿到剪裁后的 history
      getMessageHistory: async (sessionId) => {
        const store = this.getOrCreateStore(sessionId);
        const messages = await store.getMessages();

        // 如果消息数超过阈值，裁剪后回写
        if (messages.length > 0) {
          const trimmed = await trimMessages(messages, {
            maxTokens: 2000,
            strategy: 'last',
            tokenCounter: (msgs) =>
              msgs.reduce((sum, m) => {
                const content =
                  typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content);
                // 粗略估算：中文字符约 1 token/字，英文约 4 chars/token
                return sum + Math.ceil(content.length / 3);
              }, 0),
            includeSystem: true,
          });

          // 用裁剪后的消息替换存储
          const trimmedStore = new InMemoryChatMessageHistory(trimmed);
          this.stores.set(sessionId, trimmedStore);
          return trimmedStore;
        }

        return store;
      },
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  // ---------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------

  private getOrCreateStore(sessionId: string): InMemoryChatMessageHistory {
    if (!this.stores.has(sessionId)) {
      this.stores.set(sessionId, new InMemoryChatMessageHistory());
    }
    return this.stores.get(sessionId)!;
  }

  // ---------------------------------------------------------------
  // 对外 API
  // ---------------------------------------------------------------

  /**
   * 基础版多轮对话（保留全部历史）
   */
  async chat(sessionId: string, input: string): Promise<string> {
    this.logger.log(`[chat] sessionId=${sessionId}, input=${input}`);
    return this.chainWithHistory.invoke(
      { input },
      { configurable: { sessionId } },
    );
  }

  /**
   * 裁剪版多轮对话（trimMessages: maxTokens=2000, strategy='last'）
   */
  async chatTrimmed(sessionId: string, input: string): Promise<string> {
    this.logger.log(`[chatTrimmed] sessionId=${sessionId}, input=${input}`);
    return this.chainWithTrimmedHistory.invoke(
      { input },
      { configurable: { sessionId } },
    );
  }

  /**
   * 获取指定 session 的历史消息
   */
  async getHistory(sessionId: string): Promise<BaseMessage[]> {
    return this.getOrCreateStore(sessionId).getMessages();
  }

  /**
   * 手动追加一对 human + ai 消息到指定 session
   */
  async appendMessage(
    sessionId: string,
    human: string,
    ai: string,
  ): Promise<void> {
    const store = this.getOrCreateStore(sessionId);
    await store.addMessage(new HumanMessage(human));
    await store.addMessage(new AIMessage(ai));
  }

  /**
   * 清除指定 session 的全部记忆
   */
  async clearSession(sessionId: string): Promise<void> {
    this.stores.delete(sessionId);
    this.logger.log(`[clearSession] sessionId=${sessionId} cleared`);
  }
}
