import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from './model.factory';

const INPUT_TEXT = '用户注册时必须绑定手机号，密码至少8位';
const SYSTEM_ROLE = '需求结构化抽取助手';

@Injectable()
export class LlmService {
  private buildMessages() {
    return [
      new SystemMessage(SYSTEM_ROLE),
      new HumanMessage(INPUT_TEXT),
    ];
  }

  async invoke() {
    const model = createChatModel();
    const response = await model.invoke(this.buildMessages());

    return {
      input: INPUT_TEXT,
      content: response.text,
      response,
    };
  }

  async stream() {
    const model = createChatModel();
    const chunks: string[] = [];

    for await (const chunk of await model.stream(this.buildMessages())) {
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
    const model = createChatModel();
    const safeCount = Math.max(1, count);
    const responses = await model.batch(
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
