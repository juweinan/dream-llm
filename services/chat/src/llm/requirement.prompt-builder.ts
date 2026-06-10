import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt';

export function createRequirementPromptTemplate() {
  // 将模版常量对应的 system 和 human 两段消息组装成可复用提示
  return ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);
}
