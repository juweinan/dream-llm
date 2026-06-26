import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import { MessageRole } from '../prisma/generated';
import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { MessageService } from './message.service';

/**
 * 基于 PostgreSQL 的聊天历史记录实现。
 * 继承 BaseListChatMessageHistory，与 RunnableWithMessageHistory 完全兼容。
 *
 * 每个实例绑定一个 conversationId，通过 MessageService 读写 messages 表。
 */
export class DbChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ['langchain', 'stores', 'message', 'db'];

  private conversationId: string;
  private messageService: MessageService;

  constructor(conversationId: string, messageService: MessageService) {
    super();
    this.conversationId = conversationId;
    this.messageService = messageService;
  }

  /**
   * 从 messages 表获取当前会话的全部消息，转为 LangChain 格式
   */
  async getMessages(): Promise<BaseMessage[]> {
    return this.messageService.getHistoryAsLangChainMessages(
      this.conversationId,
    );
  }

  /**
   * 添加单条消息到 messages 表
   */
  async addMessage(message: BaseMessage): Promise<void> {
    const role =
      message.getType() === 'human' ? MessageRole.USER : MessageRole.ASSISTANT;
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);

    await this.messageService.addMessage(this.conversationId, role, content);
  }

  /**
   * 批量添加消息（一次写入多条，减少数据库往返）
   */
  async addMessages(messages: BaseMessage[]): Promise<void> {
    for (const message of messages) {
      await this.addMessage(message);
    }
  }

  /**
   * 清除当前会话的全部消息
   */
  async clear(): Promise<void> {
    await this.messageService.clearMessages(this.conversationId);
  }
}
