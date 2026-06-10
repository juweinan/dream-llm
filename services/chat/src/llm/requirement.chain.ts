import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from './model.factory';
import { createRequirementPromptTemplate } from './requirement.prompt-builder';

const requirementPrompt = createRequirementPromptTemplate();
const model = createChatModel();

export const requirementChain = requirementPrompt
  .pipe(model)
  .pipe(new StringOutputParser());
