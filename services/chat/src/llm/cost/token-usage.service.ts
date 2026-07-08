// ---------------------------------------------------------------
// 10.8.2 TokenUsageService — 节点级 Token Usage 持久化
//
// 用途：每次 LLM 调用后，将 token 用量记录写入 token_usages
// 表，支持按月度 / 节点 / Agent 聚合查询和预算判断。
//
// 写入失败只 console.warn，不抛异常（侧路采集）。
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 兼容 Prisma 生成的 TokenUsage delegate
// 使用最小接口以便注入 NestJS PrismaService 或 mock
// ---------------------------------------------------------------
interface TokenUsageDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<unknown>;
  aggregate(args: {
    _sum?: Record<string, boolean>;
    _count?: boolean | Record<string, boolean>;
    where?: Record<string, unknown>;
  }): Promise<{ _sum?: Record<string, number | null>; _count?: number | null }>;
  groupBy(args: {
    by: string[];
    _sum?: Record<string, boolean>;
    _count?: boolean | Record<string, boolean>;
    where?: Record<string, unknown>;
    orderBy?: Record<string, string>[];
  }): Promise<Record<string, unknown>[]>;
}

export interface TokenUsageClient {
  tokenUsage: TokenUsageDelegate;
}

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

/**
 * 与 token_usages 表字段对齐。
 * graphName / nodeName / agentName / modelName 必填，其余可选。
 */
export interface TokenUsageRecord {
  graphName: string;
  nodeName: string;
  agentName: string;
  modelName: string;

  conversationId?: string;
  messageId?: string;
  threadId?: string;
  modelConfigId?: string;
  provider?: string;

  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;

  estimatedCostUsd?: number;
  isEstimated?: boolean;
  latencyMs?: number;
  overrideReason?: string;
}

export interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}

export interface NodeStats {
  nodeName: string;
  totalCost: number;
  calls: number;
}

export interface AgentStats {
  agentName: string;
  totalCost: number;
  calls: number;
}

// ---------------------------------------------------------------
// TokenUsageService
// ---------------------------------------------------------------
export class TokenUsageService {
  constructor(private readonly prisma: TokenUsageClient) {}

  /**
   * 写入一条 token 用量记录。
   * 任何异常只 console.warn，不抛出（侧路采集）。
   */
  async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      const totalTokens =
        record.totalTokens ??
        (record.inputTokens ?? 0) + (record.outputTokens ?? 0);

      await this.prisma.tokenUsage.create({
        data: {
          graphName: record.graphName,
          nodeName: record.nodeName,
          agentName: record.agentName,
          modelName: record.modelName,

          conversationId: record.conversationId ?? null,
          messageId: record.messageId ?? null,
          threadId: record.threadId ?? null,
          modelConfigId: record.modelConfigId ?? null,
          provider: record.provider ?? 'openai',

          inputTokens: record.inputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          totalTokens,
          cachedInputTokens: record.cachedInputTokens ?? 0,

          estimatedCostUsd: record.estimatedCostUsd ?? 0,
          isEstimated: record.isEstimated ?? false,
          latencyMs: record.latencyMs ?? 0,
          overrideReason: record.overrideReason ?? null,
        },
      });
    } catch (err) {
      console.warn('[TokenUsageService] recordUsage 写入失败（不阻塞主流程）:', err);
    }
  }

  /**
   * 当月聚合统计。
   */
  async getMonthlyStats(): Promise<MonthlyStats> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
      const result = await this.prisma.tokenUsage.aggregate({
        _sum: {
          estimatedCostUsd: true,
          inputTokens: true,
          outputTokens: true,
          cachedInputTokens: true,
        },
        _count: true,
        where: {
          createdAt: { gte: startOfMonth },
        },
      });

      return {
        totalCost: result._sum?.estimatedCostUsd ?? 0,
        totalInputTokens: result._sum?.inputTokens ?? 0,
        totalOutputTokens: result._sum?.outputTokens ?? 0,
        totalCachedTokens: result._sum?.cachedInputTokens ?? 0,
        calls: (result._count as number) ?? 0,
      };
    } catch (err) {
      console.warn('[TokenUsageService] getMonthlyStats 查询失败:', err);
      return {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        calls: 0,
      };
    }
  }

  /**
   * 按 nodeName 聚合，按 totalCost 降序。
   */
  async getStatsByNode(): Promise<NodeStats[]> {
    try {
      const rows = await this.prisma.tokenUsage.groupBy({
        by: ['nodeName'],
        _sum: { estimatedCostUsd: true },
        _count: { estimatedCostUsd: true },
        orderBy: [{ _sum: { estimatedCostUsd: 'desc' } }],
      });

      return rows.map((r) => ({
        nodeName: r.nodeName as string,
        totalCost: (r._sum as Record<string, number>)?.estimatedCostUsd ?? 0,
        calls: (r._count as number) ?? 0,
      }));
    } catch (err) {
      console.warn('[TokenUsageService] getStatsByNode 查询失败:', err);
      return [];
    }
  }

  /**
   * 按 agentName 聚合，按 totalCost 降序。
   */
  async getStatsByAgent(): Promise<AgentStats[]> {
    try {
      const rows = await this.prisma.tokenUsage.groupBy({
        by: ['agentName'],
        _sum: { estimatedCostUsd: true },
        _count: { estimatedCostUsd: true },
        orderBy: [{ _sum: { estimatedCostUsd: 'desc' } }],
      });

      return rows.map((r) => ({
        agentName: r.agentName as string,
        totalCost: (r._sum as Record<string, number>)?.estimatedCostUsd ?? 0,
        calls: (r._count as number) ?? 0,
      }));
    } catch (err) {
      console.warn('[TokenUsageService] getStatsByAgent 查询失败:', err);
      return [];
    }
  }

  /**
   * 判断当月成本是否超出预算。
   */
  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    try {
      const stats = await this.getMonthlyStats();
      return stats.totalCost >= monthlyBudgetUsd;
    } catch {
      // 查询失败时保守返回 false（不阻塞调用）
      return false;
    }
  }
}
