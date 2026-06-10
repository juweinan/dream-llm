import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { createChatModel } from './model.factory';
import { requirementChain } from './requirement.chain';
import { createRequirementPromptTemplate } from './requirement.prompt-builder';
import { basicTools } from './tools/basic.tools';

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

  private normalizeInput(input: string) {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      throw new BadRequestException('input 不能为空');
    }

    return normalizedInput;
  }

  async promptPreview(input: string) {
    const prompt = createRequirementPromptTemplate();
    const normalizedInput = this.normalizeInput(input);
    const messages = await prompt.formatMessages({ input: normalizedInput });

    return {
      input: normalizedInput,
      messages: messages.map((message) => ({
        type: message.type,
        content: message.content.toString(),
      })),
    };
  }

  async promptToModel(input: string) {
    const prompt = createRequirementPromptTemplate();
    const normalizedInput = this.normalizeInput(input);
    const messages = await prompt.formatMessages({ input: normalizedInput });
    const response = await this.model.invoke(messages);

    return {
      input: normalizedInput,
      messages: messages.map((message) => ({
        type: message.type,
        content: message.content.toString(),
      })),
      content: response.content.toString(),
      response,
    };
  }

  async toolBind(input: string) {
    const normalizedInput = this.normalizeInput(input);
    const modelWithTools = this.model.bindTools([...basicTools]);
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一名需求结构化抽取助手。可按需调用工具检查约束有效性和查询实体定义。',
      ),
      new HumanMessage(`请分析以下需求，并在必要时调用工具：${normalizedInput}`),
    ];
    const response = await modelWithTools.invoke(messages);

    return {
      input: normalizedInput,
      content: response.content.toString(),
      toolCalls: response.tool_calls ?? [],
      response,
    };
  }

  async toolLoop(input: string) {
    const normalizedInput = this.normalizeInput(input);
    const modelWithTools = this.model.bindTools([...basicTools]);
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一名需求结构化抽取助手。可按需调用工具检查约束有效性和查询实体定义。',
      ),
      new HumanMessage(
        `请基于以下需求做结构化分析；如有必要，先调用工具再输出最终结论：${normalizedInput}`,
      ),
    ];
    const toolSteps: Array<{ name: string; args: unknown; result: unknown }> = [];

    while (true) {
      const response = await modelWithTools.invoke(messages);
      messages.push(response);

      if (!response.tool_calls?.length) {
        return {
          input: normalizedInput,
          content: response.content.toString(),
          toolSteps,
          response,
        };
      }

      for (const toolCall of response.tool_calls) {
        const selectedTool = basicTools.find((tool) => tool.name === toolCall.name);
        if (!selectedTool) {
          continue;
        }

        const toolExecutor = selectedTool as {
          invoke: (args: unknown) => Promise<unknown>;
        };
        const result = await toolExecutor.invoke(toolCall.args);
        toolSteps.push({
          name: toolCall.name,
          args: toolCall.args,
          result,
        });
        messages.push(
          new ToolMessage({
            tool_call_id: toolCall.id ?? toolCall.name,
            content: JSON.stringify(result),
          }),
        );
      }
    }
  }

  async chainInvoke(input: string) {
    const normalizedInput = this.normalizeInput(input);
    const content = await requirementChain.invoke({ input: normalizedInput });

    return {
      input: normalizedInput,
      content,
    };
  }

  async *chainStream(input: string) {
    const normalizedInput = this.normalizeInput(input);

    for await (const chunk of await requirementChain.stream({
      input: normalizedInput,
    })) {
      if (chunk) {
        yield chunk;
      }
    }
  }

  async chainBatch(inputs: string[]) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('inputs 不能为空数组');
    }

    const safeInputs = inputs
      .map((input) => input.trim())
      .filter((input) => input.length > 0);

    if (safeInputs.length === 0) {
      throw new BadRequestException('inputs 不能为空数组');
    }

    const items = await requirementChain.batch(
      safeInputs.map((input) => ({ input })),
    );

    return {
      count: safeInputs.length,
      items: items.map((content, index) => ({
        input: safeInputs[index],
        content,
      })),
    };
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
