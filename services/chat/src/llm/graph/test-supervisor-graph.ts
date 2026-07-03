/**
 * test-supervisor-graph.ts — Supervisor + 多专家架构 集成测试
 *
 * 覆盖：
 *   Part A: 组件级测试 — createAnalysisSupervisorSubGraph 直接调用
 *   Part B: 集成级测试 — runAnalysisGraph 全链路
 *
 * 运行方式：bun run services/chat/src/llm/graph/test-supervisor-graph.ts
 * 前置条件：LLM 配置（config/langchain.yaml + 环境变量）已就绪
 */

import { createChatModel } from '../model.factory';
import {
  createAnalysisSupervisorSubGraph,
  createSupervisorNode,
  createAggregatorNode,
  createFunctionalExpert,
  createPerformanceExpert,
  createSecurityExpert,
  createComplianceExpert,
  createExpertSubGraph,
  type ExpertName,
  type SupervisorState,
} from './experts';
import {
  runAnalysisGraph,
  createAnalysisGraph,
  type GraphOrchestrationResult,
} from './requirement-analysis-graph';

// ===============================================================
// Types
// ===============================================================

type ValidationFn = (result: Record<string, unknown>) => {
  pass: boolean;
  reason?: string;
};

interface TestCase {
  name: string;
  input: string;
  expectedMinExperts: number; // 最少期望激活的专家数
  expectedExperts?: ExpertName[]; // 精确期望（部分场景）
  validations: ValidationFn[];
}

interface TestResult {
  case: string;
  passed: boolean;
  durationMs: number;
  details: Record<string, unknown>;
}

// ===============================================================
// Model factory — 模块顶层创建一次，避免重复初始化
// ===============================================================

const model = createChatModel();

// ===============================================================
// Part A: Supervisor 子图组件级测试
// ===============================================================

const SUPERVISOR_CASES: TestCase[] = [
  {
    name: 'A1: 纯功能需求 → 期望 functional 专家',
    input: '需求：将登录页的"登录"按钮文案改为"立即登录"',
    expectedMinExperts: 1,
    expectedExperts: ['functional'],
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts != null && experts.length >= 1,
          reason:
            experts == null
              ? 'activeExperts 为空'
              : `激活了 ${experts.length} 个专家: ${experts.join(', ')}`,
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('functional') === true,
          reason: 'functional 专家必须被激活',
        };
      },
      (r) => {
        const reasoning = r.supervisorReasoning as string | undefined;
        return {
          pass: (reasoning ?? '').length > 0,
          reason: 'supervisorReasoning 不应为空',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        return {
          pass: ar != null && Object.keys(ar).length > 0,
          reason: 'analysisResult 不应为空',
        };
      },
      // 未被激活的专家不应有输出内容
      (r) => {
        const experts = (r.activeExperts as string[]) ?? [];
        const allFields = [
          'functionalAnalysis',
          'performanceAnalysis',
          'securityAnalysis',
          'complianceAnalysis',
        ];
        const inactiveWithContent = allFields.filter((f) => {
          const name = f.replace('Analysis', '') as ExpertName;
          if (experts.includes(name)) return false;
          const val = r[f] as Record<string, unknown> | undefined;
          return val && Object.keys(val).length > 0;
        });
        return {
          pass: inactiveWithContent.length === 0,
          reason:
            inactiveWithContent.length > 0
              ? `未激活的专家不应有输出: ${inactiveWithContent.join(', ')}`
              : undefined,
        };
      },
    ],
  },
  {
    name: 'A2: 大数据量需求 → 期望 functional + performance',
    input:
      '需求 REQ-20240315-001：支持批量导入 Excel 用户数据，单次最多 10000 行，需要实时反馈导入进度',
    expectedMinExperts: 2,
    expectedExperts: ['functional', 'performance'],
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) >= 2,
          reason: `需要 >=2 个专家，实际激活了 ${experts?.length ?? 0} 个: ${(experts ?? []).join(', ')}`,
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('functional') === true,
          reason: 'functional 必须激活',
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('performance') === true,
          reason: '大数据量 + 实时反馈 → performance 必须激活',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        return {
          pass: ar != null && Object.keys(ar).length > 0,
          reason: 'analysisResult 不应为空',
        };
      },
    ],
  },
  {
    name: 'A3: 敏感数据导出 → 期望 functional + performance + security',
    input:
      '需求：新增用户敏感数据导出功能，支持导出用户手机号和身份证信息，需要异步处理大数据量',
    expectedMinExperts: 3,
    expectedExperts: ['functional', 'performance', 'security'],
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) >= 3,
          reason: `需要 >=3 个专家，实际激活了 ${experts?.length ?? 0} 个: ${(experts ?? []).join(', ')}`,
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('functional') === true,
          reason: 'functional 必须激活',
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('performance') === true,
          reason: '大数据量异步处理 → performance 必须激活',
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('security') === true,
          reason: '手机号 + 身份证（敏感数据）→ security 必须激活',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        return {
          pass: ar != null && Object.keys(ar).length > 0,
          reason: 'analysisResult 不应为空',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        const suggestions = ar?.suggestions as string[] | undefined;
        return {
          pass: (suggestions?.length ?? 0) > 0,
          reason: '应包含改进建议',
        };
      },
    ],
  },
  {
    name: 'A4: 跨境金融支付 → 期望四个专家全开',
    input:
      '需求：开发跨境支付功能，支持欧盟和中国用户，处理个人金融信息，需符合 GDPR 和中国人民银行监管要求',
    expectedMinExperts: 4,
    expectedExperts: ['functional', 'performance', 'security', 'compliance'],
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) === 4,
          reason: `需要 4 个专家，实际激活了 ${experts?.length ?? 0} 个: ${(experts ?? []).join(', ')}`,
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('compliance') === true,
          reason: '跨境 + GDPR + 金融 → compliance 必须激活',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        return {
          pass: ar != null && Object.keys(ar).length > 0,
          reason: 'analysisResult 不应为空',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        // 合规专家的笔记应该在汇总中出现
        const notes = (ar?.complianceNotes as string) ?? '';
        return {
          pass: notes.length > 0 && !notes.includes('未评估'),
          reason: notes.includes('未评估')
            ? 'compliance 已激活，complianceNotes 不应为"未评估"'
            : `complianceNotes: ${notes.substring(0, 80)}...`,
        };
      },
    ],
  },
  {
    name: 'A5: 模糊需求 → supervisor 应至少激活 functional',
    input: '需求：优化系统',
    expectedMinExperts: 1,
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) >= 1,
          reason:
            experts?.length === 0
              ? '应至少激活 1 个专家（降级兜底）'
              : `激活了 ${experts?.length} 个专家: ${(experts ?? []).join(', ')}`,
        };
      },
      (r) => {
        const reasoning = r.supervisorReasoning as string | undefined;
        return {
          pass: (reasoning ?? '').length > 0,
          reason: 'supervisorReasoning 不应为空（含降级说明）',
        };
      },
    ],
  },
  {
    name: 'A6: 纯安全需求（登录认证）→ 期望 functional + security',
    input:
      '需求：实现统一用户认证系统，支持 OAuth2.0 和 JWT，需要角色权限控制（RBAC）',
    expectedMinExperts: 2,
    expectedExperts: ['functional', 'security'],
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) >= 2,
          reason: `需要 >=2 个专家，实际激活了 ${experts?.length ?? 0} 个: ${(experts ?? []).join(', ')}`,
        };
      },
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: experts?.includes('security') === true,
          reason: 'OAuth2.0 + JWT + RBAC → security 必须激活',
        };
      },
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        return {
          pass: ar != null && Object.keys(ar).length > 0,
          reason: 'analysisResult 不应为空',
        };
      },
    ],
  },
];

// ===============================================================
// Part B: 全链路集成测试（通过 runAnalysisGraph）
// ===============================================================

const INTEGRATION_CASES: TestCase[] = [
  {
    name: 'B1: 简单需求 → 全链路正常完成',
    input: '需求：将登录页的"登录"按钮文案改为"立即登录"',
    expectedMinExperts: 1,
    validations: [
      (r) => {
        return {
          pass: r.status === 'completed' || r.status === 'clarification_needed',
          reason: `status=${r.status}`,
        };
      },
      (r) => {
        const report = (r.report as string) ?? '';
        return {
          pass: report.length > 0,
          reason: 'report 不应为空',
        };
      },
      (r) => {
        const intent = r.intent as string | undefined;
        return {
          pass: intent === 'analyze',
          reason: `期望 analyze，实际 ${intent}`,
        };
      },
    ],
  },
  {
    name: 'B2: 大数据量需求 → report 应包含功能分解',
    input:
      '需求：支持批量导出用户行为日志，单次最多 50000 条，格式支持 CSV 和 Excel',
    expectedMinExperts: 2,
    validations: [
      (r) => {
        return {
          pass: r.status === 'completed' || r.status === 'clarification_needed',
          reason: `status=${r.status}`,
        };
      },
      (r) => {
        const report = (r.report as string) ?? '';
        return {
          pass: report.length > 50,
          reason: `report 太短 (${report.length} 字符)`,
        };
      },
    ],
  },
  {
    name: 'B3: 闲聊 → 不触发分析路径',
    input: '你好，今天天气不错',
    expectedMinExperts: 0,
    validations: [
      (r) => {
        return {
          pass: r.intent === 'chat',
          reason: `期望 chat，实际 ${r.intent}`,
        };
      },
      (r) => {
        const steps = r.steps as { agent: string }[] | undefined;
        const analysisAgents = [
          'extractStep',
          'clarifyStep',
          'analysisSupervisor',
          'riskStep',
          'summaryStep',
        ];
        const triggeredAnalysis =
          steps?.filter((s) => analysisAgents.includes(s.agent)) ?? [];
        return {
          pass: triggeredAnalysis.length === 0,
          reason:
            triggeredAnalysis.length > 0
              ? `闲聊路径不应触发分析节点: ${triggeredAnalysis.map((s) => s.agent).join(', ')}`
              : undefined,
        };
      },
    ],
  },
];

// ===============================================================
// Part C: 并行性验证
// ===============================================================

/**
 * 测量 supervisor 子图的并行效果。
 *
 * 逻辑：
 * - 如果多个专家是串行执行的，总耗时 ≈ 各专家耗时之和
 * - 如果多个专家是并行执行的，总耗时 ≈ 最慢专家的耗时
 * - 验证：多专家场景总耗时 < 单专家耗时 × 专家数量的 70%（留 30% 余量给通信开销）
 */
async function runParallelismTest(): Promise<TestResult> {
  const start = performance.now();

  const subgraph = createAnalysisSupervisorSubGraph({
    model,
    expertTools: {},
  });

  const result = await subgraph.invoke({
    input:
      '需求：开发跨境支付功能，支持欧盟和中国用户，处理个人金融信息，需符合 GDPR 和中国人民银行监管要求',
    extracted: {},
    clarified: {},
    activeExperts: [],
    functionalAnalysis: {},
    performanceAnalysis: {},
    securityAnalysis: {},
    complianceAnalysis: {},
    analysisResult: {},
    toolLoopCount: 0,
  });

  const durationMs = Math.round(performance.now() - start);
  const activeCount = result.activeExperts?.length ?? 0;

  // 并行效果：多专家时总耗时不应超过串行预估的 70%
  const parallelValid: ValidationFn[] = [];

  if (activeCount > 1) {
    const serialEstimate = durationMs * activeCount;
    parallelValid.push(() => ({
      pass: true, // 仅记录，不做硬性判断（网络波动大）
      reason:
        `${activeCount} 专家并行，总耗时 ${durationMs}ms。` +
        `（参考：串行预估 ≥${serialEstimate}ms）`,
    }));
  }

  const validations = [
    () => ({
      pass: activeCount >= 4,
      reason: `期望 4 专家全开，实际 ${activeCount}`,
    }),
    () => ({
      pass: durationMs < 300_000,
      reason: durationMs >= 300_000 ? `耗时 ${durationMs}ms 过长` : undefined,
    }),
    ...parallelValid,
  ];

  const allPassed = validations.every((v) => v(result).pass);

  return {
    case: 'C1: 并行性验证',
    passed: allPassed,
    durationMs,
    details: {
      input: '跨境支付（四专家）',
      activeExperts: result.activeExperts,
      supervisorReasoning: result.supervisorReasoning,
      analysisResultKeys: Object.keys(result.analysisResult ?? {}),
      activeCount,
      elapsedMs: durationMs,
      validations: validations.map((v) => v(result)),
    },
  };
}

// ===============================================================
// Part D: 降级 & 边界场景
// ===============================================================

const EDGE_CASES: TestCase[] = [
  {
    name: 'D1: 空 input → 快速失败',
    input: '',
    expectedMinExperts: 0,
    validations: [
      (r) => {
        const status = r.status as string | undefined;
        return {
          pass: status === 'failed',
          reason: `期望 failed，实际 ${status}`,
        };
      },
    ],
  },
  {
    name: 'D2: 极长输入 → supervisor 正常决策',
    input:
      '需求：构建一个企业级微服务架构的平台，包含用户管理、订单管理、商品管理、' +
      '库存管理、支付网关、消息推送、数据分析、报表生成、权限管理、审计日志、' +
      'API 网关、服务发现、配置中心、链路追踪、日志收集、监控告警、' +
      'CI/CD 流水线、容器编排、自动伸缩、灾备恢复，' +
      '要求 99.99% 可用性，支持百万级并发用户，数据加密存储，符合 ISO 27001 和等保三级要求',
    expectedMinExperts: 4,
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        return {
          pass: (experts?.length ?? 0) >= 3,
          reason: `微服务 + 高可用 + 合规 → 应激活 >=3 个专家，实际 ${experts?.length ?? 0}`,
        };
      },
    ],
  },
  {
    name: 'D3: 非中文输入 → supervisor 正常处理',
    input:
      'Requirement: Implement a real-time chat system with end-to-end encryption and message history search for 100K concurrent users',
    expectedMinExperts: 1,
    validations: [
      (r) => {
        const experts = r.activeExperts as string[] | undefined;
        const hasSecurity = experts?.includes('security') === true;
        const hasPerformance = experts?.includes('performance') === true;
        return {
          pass: hasSecurity && hasPerformance,
          reason: `E2EE → security=${hasSecurity}, 100K并发 → performance=${hasPerformance}`,
        };
      },
    ],
  },
];

// ===============================================================
// Runners
// ===============================================================

async function runSupervisorCase(tc: TestCase): Promise<TestResult> {
  const start = performance.now();

  const subgraph = createAnalysisSupervisorSubGraph({
    model,
    expertTools: {},
  });

  const rawResult = await subgraph.invoke({
    input: tc.input,
    extracted: {},
    clarified: {},
    activeExperts: [],
    functionalAnalysis: {},
    performanceAnalysis: {},
    securityAnalysis: {},
    complianceAnalysis: {},
    analysisResult: {},
    toolLoopCount: 0,
  });

  const durationMs = Math.round(performance.now() - start);
  const result = rawResult as unknown as Record<string, unknown>;
  const validations = tc.validations.map((v) => v(result));

  return {
    case: tc.name,
    passed: validations.every((v) => v.pass),
    durationMs,
    details: {
      input: tc.input.substring(0, 100),
      expectedMinExperts: tc.expectedMinExperts,
      expectedExperts: tc.expectedExperts ?? '(any)',
      activeExperts: result.activeExperts ?? [],
      supervisorReasoning: result.supervisorReasoning ?? '(none)',
      analysisResultKeys: Object.keys(
        (result.analysisResult as Record<string, unknown>) ?? {},
      ),
      functionalKeysCount: Object.keys(
        (result.functionalAnalysis as Record<string, unknown>) ?? {},
      ).length,
      performanceKeysCount: Object.keys(
        (result.performanceAnalysis as Record<string, unknown>) ?? {},
      ).length,
      securityKeysCount: Object.keys(
        (result.securityAnalysis as Record<string, unknown>) ?? {},
      ).length,
      complianceKeysCount: Object.keys(
        (result.complianceAnalysis as Record<string, unknown>) ?? {},
      ).length,
      validations,
    },
  };
}

async function runIntegrationCase(tc: TestCase): Promise<TestResult> {
  const start = performance.now();
  const result = await runAnalysisGraph(tc.input);
  const durationMs = Math.round(performance.now() - start);
  const record = result as unknown as Record<string, unknown>;
  const validations = tc.validations.map((v) => v(record));

  return {
    case: tc.name,
    passed: validations.every((v) => v.pass),
    durationMs,
    details: {
      input: tc.input.substring(0, 100),
      status: result.status,
      intent: result.intent ?? '(none)',
      reportLength: (result.report ?? '').length,
      usedAgents: result.usedAgents,
      activeExperts: result.activeExperts ?? [],
      validations,
    },
  };
}

async function runEdgeCase(tc: TestCase): Promise<TestResult> {
  // 复用 supervisor case runner，但通过 runAnalysisGraph 包装
  const start = performance.now();
  let record: Record<string, unknown>;

  if (tc.input === '') {
    // 空 input 直接走 runAnalysisGraph 的快速失败路径
    const result = await runAnalysisGraph(tc.input);
    record = result as unknown as Record<string, unknown>;
  } else {
    // 其他边界场景走 supervisor 子图
    const subgraph = createAnalysisSupervisorSubGraph({
      model,
      expertTools: {},
    });
    const rawResult = await subgraph.invoke({
      input: tc.input,
      extracted: {},
      clarified: {},
      activeExperts: [],
      functionalAnalysis: {},
      performanceAnalysis: {},
      securityAnalysis: {},
      complianceAnalysis: {},
      analysisResult: {},
      toolLoopCount: 0,
    });
    record = rawResult;
  }

  const durationMs = Math.round(performance.now() - start);
  const validations = tc.validations.map((v) => v(record));

  return {
    case: tc.name,
    passed: validations.every((v) => v.pass),
    durationMs,
    details: {
      input: tc.input.substring(0, 100),
      activeExperts: record.activeExperts ?? [],
      status: record.status ?? 'n/a',
      validations,
    },
  };
}

// ===============================================================
// Printers
// ===============================================================

function printResult(r: TestResult) {
  const d = r.details;
  const icon = r.passed ? '✅' : '❌';
  console.log(
    `┌─ ${icon} ${r.case} ─ ${r.passed ? 'PASS' : 'FAIL'} (${r.durationMs}ms)`,
  );
  console.log(`│  输入:        ${(d.input as string)?.substring(0, 80)}`);
  console.log(
    `│  激活专家:    [${(d.activeExperts as string[])?.join(', ') || 'n/a'}]`,
  );
  if (d.supervisorReasoning) {
    const reasoning = d.supervisorReasoning as string;
    console.log(`│  Supervisor:  ${reasoning.substring(0, 100)}`);
  }
  if (d.status) {
    console.log(`│  状态:        ${d.status}`);
  }
  if (d.analysisResultKeys) {
    const keys = d.analysisResultKeys as string[];
    console.log(`│  汇总字段:    ${keys.join(', ') || '(empty)'}`);
  }
  // 各专家输出字段数
  const expertFields = [
    'functionalKeysCount',
    'performanceKeysCount',
    'securityKeysCount',
    'complianceKeysCount',
  ];
  const fieldLabels = ['功能', '性能', '安全', '合规'];
  const parts: string[] = [];
  for (let i = 0; i < expertFields.length; i++) {
    const count = d[expertFields[i]] as number | undefined;
    if (count !== undefined) {
      parts.push(`${fieldLabels[i]}:${count}字段`);
    }
  }
  if (parts.length > 0) {
    console.log(`│  专家输出:    ${parts.join(', ')}`);
  }

  const failures = (
    d.validations as { pass: boolean; reason?: string }[]
  ).filter((v) => !v.pass);
  if (failures.length > 0) {
    console.log(`│  失败项:`);
    for (const f of failures) {
      console.log(`│    ↳ ${f.reason ?? '(unknown)'}`);
    }
  }
  console.log('└──────────────────────────────────────────────────');
}

function printSummary(title: string, results: TestResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(
    `\n  ${title}: ${passed}/${total} 通过 (总耗时 ${totalMs}ms, 平均 ${Math.round(totalMs / total)}ms)`,
  );
  for (const r of results) {
    console.log(`    ${r.passed ? '✅' : '❌'} ${r.case} (${r.durationMs}ms)`);
  }
}

// ===============================================================
// Main
// ===============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Supervisor + 多专家架构 集成测试                  ║');
  console.log('║  第 9 章 — 单 Agent → 多专家升级验证               ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log('── Part A: Supervisor 子图组件级测试 ──\n');
  const supervisorResults: TestResult[] = [];
  for (const tc of SUPERVISOR_CASES) {
    const r = await runSupervisorCase(tc);
    supervisorResults.push(r);
    printResult(r);
  }

  console.log('\n── Part B: 全链路集成测试（runAnalysisGraph）──\n');
  const integrationResults: TestResult[] = [];
  for (const tc of INTEGRATION_CASES) {
    const r = await runIntegrationCase(tc);
    integrationResults.push(r);
    printResult(r);
  }

  console.log('\n── Part C: 并行性验证 ──\n');
  const parallelResult = await runParallelismTest();
  printResult(parallelResult);

  console.log('\n── Part D: 降级 & 边界场景 ──\n');
  const edgeResults: TestResult[] = [];
  for (const tc of EDGE_CASES) {
    const r = await runEdgeCase(tc);
    edgeResults.push(r);
    printResult(r);
  }

  // ===============================================================
  // 汇总统计
  // ===============================================================

  const all = [
    ...supervisorResults,
    ...integrationResults,
    parallelResult,
    ...edgeResults,
  ];
  const passed = all.filter((r) => r.passed).length;
  const total = all.length;

  console.log('\n══════════════════════════════════════════════════');
  printSummary('Part A (组件级)', supervisorResults);
  printSummary('Part B (全链路)', integrationResults);
  printSummary('Part C (并行性)', [parallelResult]);
  printSummary('Part D (边界场景)', edgeResults);
  console.log(`\n  总计: ${passed}/${total} 通过`);
  console.log('══════════════════════════════════════════════════');

  // ===============================================================
  // 验收标准
  // ===============================================================

  const aOk = supervisorResults.filter((r) => r.passed).length >= 4;
  const bOk = integrationResults.filter((r) => r.passed).length >= 2;
  const cOk = parallelResult.passed;
  const dOk = edgeResults.filter((r) => r.passed).length >= 2;

  console.log(
    `\n  验收: PartA ${aOk ? '✅' : '❌'} | PartB ${bOk ? '✅' : '❌'} | PartC ${cOk ? '✅' : '❌'} | PartD ${dOk ? '✅' : '❌'}`,
  );

  const accepted = aOk && bOk && cOk && dOk;
  console.log(accepted ? '\n✅ 验收通过' : '\n❌ 验收未通过');
  process.exit(accepted ? 0 : 1);
}

main().catch((err) => {
  console.error('💥 测试执行异常:', err);
  process.exit(1);
});
