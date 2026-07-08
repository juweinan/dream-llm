// ---------------------------------------------------------------
// 10.2 设计期 Token 成本估算工具
//
// 用途：在设计 Multi-Agent 图时，快速估算"这条链路大概要花多少钱"，
// 不负责精确成本——精确值由 10.8 的 withTokenUsage 从 provider
// usage 读取。
//
// 以上价格示例自 2025–2026 年早期，仅供参考；上线前请以厂商官网为准。
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 模型定价表（每 1M tokens，单位 USD）
// ---------------------------------------------------------------
const PRICING: Record<
  string,
  { input: number; output: number; cachedInput?: number }
> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0, cachedInput: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cachedInput: 0.075 },

  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cachedInput: 0.3 },
  'claude-sonnet': { input: 3.0, output: 15.0, cachedInput: 0.3 },
  'claude-haiku': { input: 0.8, output: 4.0, cachedInput: 0.08 },

  // DeepSeek
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

// 回退模型：未知 provider/modelName 时统一按 gpt-4o-mini 计价
const FALLBACK_MODEL = 'gpt-4o-mini';

// ---------------------------------------------------------------
// 中文 / 中文标点 Unicode 区间
// ---------------------------------------------------------------
const CHINESE_RANGES: [number, number][] = [
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x3000, 0x303f], // CJK Symbols & Punctuation
  [0xff00, 0xffef], // Halfwidth & Fullwidth Forms
];

function isChineseChar(code: number): boolean {
  return CHINESE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

// ---------------------------------------------------------------
// estimateTextTokens
// ---------------------------------------------------------------
/**
 * 估算文本的 token 数量（设计期近似值，非精确计数）。
 *
 * 规则：
 * - 空字符串 / null / undefined → 0
 * - 中文字符（含中文标点 一-鿿、　-〿、＀-￯）→ 1 token
 * - 其余字符 → 每 4 字符约 1 token（即每字符 0.25）
 * - 最终结果 Math.ceil 取整
 */
export function estimateTextTokens(text: string | null | undefined): number {
  if (text == null || text === '') return 0;

  let total = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code != null && isChineseChar(code)) {
      total += 1;
    } else {
      total += 0.25;
    }
  }

  return Math.ceil(total);
}

// ---------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------
export interface ModelPricing {
  input: number;
  output: number;
  cachedInput?: number;
}

/**
 * 获取指定模型的价格（每 1M tokens，单位 USD）。
 * 未知模型回退到 gpt-4o-mini。
 */
export function getModelPricing(modelName: string): ModelPricing {
  // 精确匹配
  if (PRICING[modelName]) return { ...PRICING[modelName] };

  // 前缀匹配（claude-haiku-3-5 → claude-haiku 等变体）
  for (const key of Object.keys(PRICING)) {
    if (modelName.startsWith(key)) {
      return { ...PRICING[key] };
    }
  }

  return { ...PRICING[FALLBACK_MODEL] };
}

// ---------------------------------------------------------------
// estimateGraphNodeCost
// ---------------------------------------------------------------
export interface MessageLike {
  role?: string;
  content?: string | unknown;
}

export interface GraphNodeCostInput {
  /** 图节点名称（如 "supervisor"、"extractAgent"），仅用于日志 */
  nodeName: string;
  /** 模型名，用于查找定价 */
  modelName: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 工具 schema 定义（JSON Schema 字符串或对象），可选 */
  toolSchemas?: string[];
  /** 对话消息列表，可选 */
  messages?: (string | MessageLike)[];
  /** 预期输出文本（用于估算 output tokens） */
  outputText: string;
}

export interface GraphNodeCostResult {
  nodeName: string;
  modelName: string;
  pricing: ModelPricing;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

function stringifyMessageLike(msg: string | MessageLike): string {
  if (typeof msg === 'string') return msg;
  if (msg.content != null) {
    if (typeof msg.content === 'string') return msg.content;
    // content 可能是数组或对象，JSON 序列化
    return JSON.stringify(msg.content);
  }
  return '';
}

/**
 * 估算单个图节点的 Token 成本。
 *
 * 输入 token = systemPrompt + toolSchemas + messages 拼接后估算
 * 输出 token = estimateTextTokens(outputText)
 * 成本 = (inputTokens × pricing.input + outputTokens × pricing.output) / 1_000_000
 */
export function estimateGraphNodeCost(
  input: GraphNodeCostInput,
): GraphNodeCostResult {
  const pricing = getModelPricing(input.modelName);

  // 拼合输入文本
  const parts: string[] = [input.systemPrompt];

  if (input.toolSchemas && input.toolSchemas.length > 0) {
    parts.push(input.toolSchemas.join('\n'));
  }

  if (input.messages && input.messages.length > 0) {
    parts.push(input.messages.map(stringifyMessageLike).join('\n'));
  }

  const inputText = parts.filter((p) => p.length > 0).join('\n');
  const inputTokens = estimateTextTokens(inputText);
  const outputTokens = estimateTextTokens(input.outputText);
  const totalTokens = inputTokens + outputTokens;

  const costUsd =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

  return {
    nodeName: input.nodeName,
    modelName: input.modelName,
    pricing,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000, // 保留 6 位小数
  };
}

export { PRICING, FALLBACK_MODEL };
