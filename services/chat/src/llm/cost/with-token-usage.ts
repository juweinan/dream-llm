// ---------------------------------------------------------------
// 10.8.3 withTokenUsage — LLM 调用包装器，自动采集 Token 用量
//
// 用途：包装 model.invoke() 调用，自动从 response metadata
// 抽取真实的 token usage（或降级到字符估算），并调用
// TokenUsageService.recordUsage 持久化。
//
// 采集是侧路：任何步骤失败都不阻塞主流程返回 result。
// usageService 可传 null 彻底跳过记录。
// ---------------------------------------------------------------

import { estimateTextTokens, getModelPricing } from './token-estimator';
import { TokenUsageService } from './token-usage.service';

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

export interface WithTokenUsageOptions {
  /** 图名称，如 "requirement-analysis" */
  graphName: string;
  /** 图节点名称，如 "supervisor"、"extractAgent" */
  nodeName: string;
  /** Agent 角色名，如 "security_expert" */
  agentName: string;
  /** 模型标识，如 "gpt-4o" */
  modelName: string;

  /** 可选：数据库中的 model 配置 ID */
  modelConfigId?: string;
  /** 可选：provider 名称（默认从 response 推断或 'openai'）*/
  provider?: string;
  /** 可选：关联的会话 / 消息 / 线程 ID */
  conversationId?: string;
  messageId?: string;
  threadId?: string;
  /** 可选：模型覆盖原因（来自 resolveModelForAgent） */
  overrideReason?: string;
}

/**
 * LLM 响应的最小类型 —— 任何符合此形状的对象都可传入。
 */
export interface LLMResponseLike {
  response_metadata?: Record<string, unknown>;
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_input_tokens?: number;
  };
  content?: string | unknown;
  text?: string;
}

// ---------------------------------------------------------------
// 内部 helper：从响应中提取 usage
// ---------------------------------------------------------------

interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/**
 * 尝试从 LLM 响应的 metadata 中提取真实 token usage。
 *
 * 兼容顺序：
 * 1. LangChain v2 标准化 usage_metadata（Anthropic/OpenAI 通用）
 * 2. OpenAI response_metadata.usage（prompt_tokens / completion_tokens）
 *
 * 抽不到则返回 null，调用方走兜底估算。
 */
function extractUsageFromResponse(
  response: LLMResponseLike,
): ExtractedUsage | null {
  // ---- Path 1: LangChain v2 usage_metadata ----
  const um = response.usage_metadata;
  if (um) {
    const input = um.input_tokens;
    const output = um.output_tokens;
    if (input != null && output != null) {
      return {
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: um.cache_read_input_tokens ?? 0,
      };
    }
  }

  // ---- Path 2: OpenAI response_metadata.usage ----
  const rm = response.response_metadata as Record<string, unknown> | undefined;
  if (rm) {
    const usage = rm['usage'] as Record<string, unknown> | undefined;
    if (usage) {
      const input =
        (usage['input_tokens'] as number) ??
        (usage['prompt_tokens'] as number);
      const output =
        (usage['output_tokens'] as number) ??
        (usage['completion_tokens'] as number);
      if (input != null && output != null) {
        let cachedInputTokens = 0;
        // OpenAI nested cached_tokens
        const details = usage['prompt_tokens_details'] as
          | Record<string, unknown>
          | undefined;
        if (details?.cached_tokens != null) {
          cachedInputTokens = details.cached_tokens as number;
        } else if (usage['cache_read_input_tokens'] != null) {
          cachedInputTokens = usage['cache_read_input_tokens'] as number;
        }
        return { inputTokens: input, outputTokens: output, cachedInputTokens };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------
// withTokenUsage
// ---------------------------------------------------------------

/**
 * 包装一次 LLM 调用，自动采集 token usage 并持久化。
 *
 * 行为：
 * - 计时 latencyMs
 * - 调用 fn() 拿到 result（永不拦截返回值）
 * - usageService 为 null → 直接 return result
 * - 尝试从 result.response_metadata / usage_metadata 抽取真实 usage
 * - 抽不到 → 兜底估算：
 *     outputTokens = estimateTextTokens(content)
 *     inputTokens = outputTokens × 5
 *     （倍率 5 来自 10.2 需求分析图真实样本约 5.8:1，取保守圆整，
 *       优先以 provider 真实 usage 为准）
 *     isEstimated = true
 * - 用 getModelPricing(modelName) 计算 estimatedCostUsd
 * - 调 usageService.recordUsage；异常只 console.warn 后吞掉
 *
 * @returns fn() 的原始返回值 T
 */
export async function withTokenUsage<T extends LLMResponseLike>(
  options: WithTokenUsageOptions,
  usageService: TokenUsageService | null,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();

  let result: T;
  try {
    result = await fn();
  } finally {
    // 即使 fn 抛异常，计时仍然有意义但此时无 result 可记录，
    // 所以只在成功路径记录
  }

  const latencyMs = Date.now() - startedAt;

  // 无可用的 usageService → 直接返回
  if (!usageService) {
    return result;
  }

  // 异步记录（不阻塞返回），异常吞掉
  recordUsageFromResult(usageService, options, result, latencyMs).catch(
    (err) => {
      console.warn(
        '[withTokenUsage] 后台 recordUsage 失败（不阻塞主流程）:',
        err,
      );
    },
  );

  return result;
}

/**
 * 内部实现：从 result 抽取 usage → 建 record → 调用 service。
 * 独立函数方便测试。
 */
async function recordUsageFromResult<T extends LLMResponseLike>(
  usageService: TokenUsageService,
  options: WithTokenUsageOptions,
  result: T,
  latencyMs: number,
): Promise<void> {
  const pricing = getModelPricing(options.modelName);

  // 尝试真实 usage
  const realUsage = extractUsageFromResponse(result);
  let inputTokens: number;
  let outputTokens: number;
  let cachedInputTokens: number;
  let isEstimated: boolean;

  if (realUsage) {
    inputTokens = realUsage.inputTokens;
    outputTokens = realUsage.outputTokens;
    cachedInputTokens = realUsage.cachedInputTokens;
    isEstimated = false;
  } else {
    // 兜底估算
    const rawContent =
      typeof result.content === 'string'
        ? result.content
        : result.text ?? '';
    outputTokens = estimateTextTokens(rawContent);
    // inputTokens = outputTokens × 5
    // 该倍率来自 10.2 需求分析图真实样本（约 5.8:1 取保守圆整），
    // 仅用于无 provider usage 时的设计期估算，上线后应以真实 usage 为准。
    inputTokens = outputTokens * 5;
    cachedInputTokens = 0;
    isEstimated = true;
  }

  // 计算成本（cached input 按折扣价）
  const cachedCost =
    cachedInputTokens *
    (pricing.cachedInput ?? pricing.input) /
    1_000_000;
  const freshInputCost =
    (inputTokens - cachedInputTokens) * pricing.input / 1_000_000;
  const outputCost = outputTokens * pricing.output / 1_000_000;
  const estimatedCostUsd = freshInputCost + cachedCost + outputCost;

  await usageService.recordUsage({
    graphName: options.graphName,
    nodeName: options.nodeName,
    agentName: options.agentName,
    modelName: options.modelName,
    modelConfigId: options.modelConfigId,
    provider: options.provider,
    conversationId: options.conversationId,
    messageId: options.messageId,
    threadId: options.threadId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens,
    estimatedCostUsd:
      Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    isEstimated,
    latencyMs,
    overrideReason: options.overrideReason,
  });
}
