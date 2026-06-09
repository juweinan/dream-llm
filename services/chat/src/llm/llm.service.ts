import { BadRequestException, Injectable } from '@nestjs/common';
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

  private buildStructuredMessages(input: string, promptPrefix: string) {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      throw new BadRequestException('input 不能为空');
    }

    return [
      new SystemMessage('你是一名需求结构化抽取助手'),
      new HumanMessage(`${promptPrefix}${normalizedInput}`),
    ] satisfies BaseMessage[];
  }

  async invokeDemo(input: string): Promise<string> {
    const messages = this.buildStructuredMessages(
      input,
      '请从下面文本中抽取 action、constraints、entities：\n',
    );
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

  async *stream(input: string) {
    const messages = this.buildStructuredMessages(
      input,
      '请逐步分析并输出结构化抽取结果，',
    );

    for await (const chunk of await this.model.stream(messages)) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }

  async batchDemo(inputs: string[]) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('inputs 不能为空数组');
    }

    const safeInputs = inputs
      .map((input) => input.trim())
      .filter((input) => input.length > 0);

    if (safeInputs.length === 0) {
      throw new BadRequestException('inputs 不能为空数组');
    }

    const model = this.model as {
      batch: (inputs: BaseMessage[][]) => Promise<Array<{ text: string }>>;
    };
    const responses = await model.batch(
      safeInputs.map((input) => [
        new SystemMessage('你是一名需求结构化抽取助手'),
        new HumanMessage(input),
      ]),
    );

    return {
      count: safeInputs.length,
      items: responses.map((response, index) => ({
        input: safeInputs[index],
        content: response.text,
        response,
      })),
    };
  }
}
