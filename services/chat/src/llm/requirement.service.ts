import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';
import { createChatModel } from './model.factory';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt';

@Injectable()
export class RequirementService {
  private model = createChatModel();

  private prompt = ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);

  async extract(input: string): Promise<RequirementResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      throw new BadRequestException('input 不能为空');
    }

    // 先根据 input 生成工程化的 prompt
    const messages = await this.prompt.formatMessages({
      input: normalizedInput,
    });

    // 创建一个带有标准结构化输出的模型
    const structuredModel = this.model.withStructuredOutput(
      RequirementResultSchema,
    );

    // 调用模型并返回结构化输出
    return structuredModel.invoke(messages) as Promise<RequirementResult>;
  }
}
