import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from '../model.factory';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/requirement.prompts';

const model = createChatModel();

/**
 * extractAgent — 从用户描述中抽取结构化需求字段，输出 JSON
 */
export const extractAgent = extractPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

/**
 * clarifyAgent — 判断是否需要澄清并生成问题，输出 JSON
 */
export const clarifyAgent = clarifyPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

/**
 * analysisAgent — 多维度需求分析（功能分解 / 用户故事 / 验收标准 / 依赖 / 建议），输出 JSON
 */
export const analysisAgent = analysisPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

/**
 * riskAgent — 风险识别与评估，输出 JSON
 */
export const riskAgent = riskPrompt.pipe(model).pipe(new StringOutputParser());

/**
 * summaryAgent — 汇总生成最终需求分析报告，输出 Markdown
 */
export const summaryAgent = summaryPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

/**
 * 所有子 Agent 的注册表
 */
export const subAgents = {
  extract: extractAgent,
  clarify: clarifyAgent,
  analysis: analysisAgent,
  risk: riskAgent,
  summary: summaryAgent,
} as const;
