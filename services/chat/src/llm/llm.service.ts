import { Injectable } from '@nestjs/common';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { createChatModel } from './model.factory';

const INPUT_TEXT = '用户注册时必须绑定手机号，密码至少8位';
const SYSTEM_ROLE = '需求结构化抽取助手';

@Injectable()
export class LlmService {
  private model = createChatModel();

  private buildMessages() {
    return [new SystemMessage(SYSTEM_ROLE), new HumanMessage(INPUT_TEXT)];
  }

  async invokeDemo(input: string): Promise<string> {
    const systemMessage = new SystemMessage('你是一名需求结构化抽取助手');
    const humanMessage = new HumanMessage(
      `请从下面文本中抽取 action、constraints、entities：\n${input}`,
    );
    const messages: BaseMessage[] = [systemMessage, humanMessage];
    const response = await this.model.invoke(messages);
    return response.content.toString();
  }

  async invoke() {
    const response = await this.model.invoke(this.buildMessages());

    return {
      input: INPUT_TEXT,
      content: response.text,
      response,
    };
  }

  async stream() {
    const chunks: string[] = [];

    for await (const chunk of await this.model.stream(this.buildMessages())) {
      if (chunk.text) {
        chunks.push(chunk.text);
      }
    }

    return {
      input: INPUT_TEXT,
      content: chunks.join(''),
      chunks,
    };
  }

  async batch(count = 2) {
    const safeCount = Math.max(1, count);
    const responses = await this.model.batch(
      Array.from({ length: safeCount }, () => this.buildMessages()),
    );

    return {
      input: INPUT_TEXT,
      count: safeCount,
      items: responses.map((response) => ({
        content: response.text,
        response,
      })),
    };
  }
}
