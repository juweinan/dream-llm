// ---------------------------------------------------------------
// RAGAS 评测接入 — 通过 HTTP 调用团队自封装的 Python RAGAS 微服务
//
// RAGAS 本身是 Python 库，不默认提供 REST 端点；团队自行封装了
// `POST /evaluate` 的微服务。本模块仅在 CI 触发，不耦合到主进程。
//
// 失败策略：任何网络错误 / 超时 / 非 2xx 响应都降级 —— 打 warn 日志
// 并返回 null，绝不抛错阻塞评测主流程。
// ---------------------------------------------------------------

// ================================================================
// 类型定义
// ================================================================

/** 单条评测样本 */
export interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

/** RAGAS 评测请求体 */
export interface RagasEvaluateInput {
  samples: RagasSample[];
  metrics: string[];
}

/** RAGAS 返回的指标 → 分数映射 */
export type RagasScores = Record<string, number>;

/** 运行配置（均可注入，便于单测 mock） */
export interface RagasRunnerOptions {
  /** 微服务 base URL，默认取 env RAGAS_SERVICE_URL，缺省 http://localhost:8000 */
  baseUrl?: string;
  /** 单次请求超时（毫秒），默认 60_000 */
  timeoutMs?: number;
  /** 失败后的重试次数（不含首次），默认 3 */
  maxRetries?: number;
  /** 可注入的 fetch 实现，默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 可注入的 warn 实现，默认 console.warn */
  warn?: (msg: string) => void;
}

// ================================================================
// 常量
// ================================================================

const DEFAULT_BASE_URL =
  process.env['RAGAS_SERVICE_URL'] ?? 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const ENDPOINT = '/evaluate';

// ================================================================
// runRagas
// ================================================================

/**
 * 调用 RAGAS 微服务评测，返回指标分数映射。
 *
 * - 成功：返回 `{ [metric: string]: number }`。
 * - 失败（超时 / 网络错误 / 非 2xx / 响应体非法）：重试 `maxRetries` 次后
 *   打印 warn 并返回 `null`，不抛错。
 *
 * @param input   评测样本与指标
 * @param options 运行配置（baseUrl / timeout / retries / fetch 注入等）
 */
export async function runRagas(
  input: RagasEvaluateInput,
  options: RagasRunnerOptions = {},
): Promise<RagasScores | null> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    fetchImpl = globalThis.fetch,
    warn = console.warn,
  } = options;

  const url = baseUrl.replace(/\/+$/, '') + ENDPOINT;
  const maxAttempts = maxRetries + 1; // 1 次首次 + maxRetries 次重试

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`RAGAS 服务返回非 2xx：HTTP ${res.status}`);
      }

      const data: unknown = await res.json();
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('RAGAS 返回体不是对象');
      }
      return data as RagasScores;
    } catch (err) {
      lastError = err;
      // 继续重试
    } finally {
      clearTimeout(timer);
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  warn(`RAGAS 评测不可用，已降级跳过：${reason}`);
  return null;
}
