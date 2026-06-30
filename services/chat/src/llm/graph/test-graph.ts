/**
 * test-graph.ts — 需求分析图集成测试
 *
 * Part A: 意图分类 + 条件路由 + Critic-Refine 汇总 (7 cases)
 * Part B: ReAct 分析子图专项测试 (5 cases)
 *
 * 运行方式：bun run services/chat/src/llm/graph/test-graph.ts
 * 前置条件：LLM 配置（config/langchain.yaml + 环境变量）已就绪
 */

import {
  runAnalysisGraph,
  createAnalysisSubGraph,
  GraphOrchestrationResult,
} from './requirement-analysis-graph';

// ===============================================================
// Types
// ===============================================================

type ValidationFn = (
  result: GraphOrchestrationResult,
  durationMs: number,
) => { pass: boolean; reason?: string };

interface TestCase {
  name: string;
  input: string;
  expectedIntent: 'analyze' | 'query' | 'chat';
  validations: ValidationFn[];
}

type ReActValidationFn = (
  result: Record<string, unknown>,
  durationMs: number,
) => { pass: boolean; reason?: string };

interface ReActTestCase {
  name: string;
  input: string;
  extracted?: Record<string, unknown>;
  clarified?: Record<string, unknown>;
  validations: ReActValidationFn[];
}

interface TestResult {
  case: string;
  passed: boolean;
  durationMs: number;
  details: Record<string, unknown>;
}

// ===============================================================
// Part A: Intent classification (7 cases)
//   analyze 路径覆盖 Critic-Refine 子图（actor→critic→refine→critic）
//   日志中的 [Critic] / [Refine] 即为子图执行证据
// ===============================================================

const INTENT_CASES: TestCase[] = [
  {
    name: 'A1: 完整需求分析',
    input:
      '分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型（单选、多选、填空），支持问卷发布与数据统计，要求在 3 个月内上线',
    expectedIntent: 'analyze',
    validations: [
      (r) => ({
        pass: r.intent === 'analyze',
        reason: r.intent !== 'analyze' ? `期望 analyze，实际=${r.intent}` : undefined,
      }),
      (r) => ({
        pass: r.status === 'completed' || r.status === 'clarification_needed',
        reason: `status=${r.status}`,
      }),
      (r) => ({
        pass:
          r.steps.some((s) => s.agent === 'analysisSubgraph') ||
          r.status === 'clarification_needed',
        reason: r.status !== 'clarification_needed' ? 'analysisSubgraph 未触发' : undefined,
      }),
      (r) => ({
        pass:
          r.steps.some((s) => s.agent === 'summaryStep') ||
          r.status === 'clarification_needed',
        reason: r.status !== 'clarification_needed' ? 'summaryStep 未触发' : undefined,
      }),
      // Critic-Refine 子图验收：修订次数不超过硬上限
      (r) => ({
        pass: (r.reviseCount ?? 0) <= 2,
        reason: `reviseCount=${r.reviseCount} 不应超过硬上限 2`,
      }),
    ],
  },
  {
    name: 'A2: 需求状态查询',
    input: '查询 REQ-20240315-001 的当前状态',
    expectedIntent: 'query',
    validations: [
      (r) => ({ pass: r.intent === 'query', reason: `期望 query，实际=${r.intent}` }),
      (r) => ({ pass: (r.queryResponse ?? '').length > 0, reason: 'queryResponse 为空' }),
      (r) => ({
        pass: !r.steps.some((s) => s.agent === 'analysisSubgraph'),
        reason: 'analysisSubgraph 不应在 query 路径触发',
      }),
    ],
  },
  {
    name: 'A3: 普通闲聊',
    input: '你好，今天天气不错',
    expectedIntent: 'chat',
    validations: [
      (r) => ({ pass: r.intent === 'chat', reason: `期望 chat，实际=${r.intent}` }),
      (r) => ({ pass: (r.chatResponse ?? '').length > 0, reason: 'chatResponse 为空' }),
      (_, d) => ({ pass: d < 5000, reason: `响应时间 ${d}ms ≥ 5000ms` }),
      (r) => ({ pass: !r.steps.some((s) => s.agent === 'extractStep'), reason: 'extractStep 不应触发' }),
    ],
  },
  {
    name: 'A4: 模糊意图',
    input: '看看 REQ-20240315-001 有没有什么问题',
    expectedIntent: 'analyze',
    validations: [
      (r) => ({
        pass: r.intent === 'analyze' || r.intent === 'query',
        reason: `intent 应为 analyze/query，实际=${r.intent}`,
      }),
      (r) => ({ pass: r.status !== 'failed', reason: `status=${r.status}` }),
    ],
  },
  {
    name: 'A5: 带编号的查询',
    input: 'REQ-20240415-002 的进度如何',
    expectedIntent: 'query',
    validations: [
      (r) => ({ pass: r.intent === 'query', reason: `期望 query，实际=${r.intent}` }),
      (r) => ({ pass: r.steps.some((s) => s.agent === 'queryHandler'), reason: 'queryHandler 未触发' }),
    ],
  },
  {
    name: 'A6: 简短需求分析',
    input: '我需要一个用户登录功能',
    expectedIntent: 'analyze',
    validations: [
      (r) => ({ pass: r.intent === 'analyze', reason: `期望 analyze，实际=${r.intent}` }),
      (r) => ({ pass: r.steps.some((s) => s.agent === 'extractStep'), reason: 'extractStep 未触发' }),
      (r) => ({
        pass: r.steps.some((s) => s.agent === 'summaryStep') || r.status === 'clarification_needed',
        reason: r.status !== 'clarification_needed' ? 'summaryStep 未触发' : undefined,
      }),
      (r) => ({ pass: (r.reviseCount ?? 0) <= 2, reason: `reviseCount=${r.reviseCount} 超过硬上限 2` }),
    ],
  },
  {
    name: 'A7: 多重含义',
    input: '查询 REQ-20240315-001 的风险分析报告',
    expectedIntent: 'query',
    validations: [
      (r) => ({ pass: r.intent === 'query', reason: `期望 query，实际=${r.intent}` }),
      (r) => ({ pass: (r.queryResponse ?? '').length > 0, reason: 'queryResponse 为空' }),
      (r) => ({ pass: !r.steps.some((s) => s.agent === 'analysisSubgraph'), reason: 'analysisSubgraph 不应触发' }),
    ],
  },
];

// ===============================================================
// Part B: ReAct subgraph-specific tests (5 cases)
// ===============================================================

const REACT_CASES: ReActTestCase[] = [
  {
    name: 'B1: 无编号普通需求 → 直接分析',
    input: '开发一个数据导出功能，支持 CSV 和 Excel 格式，需要异步处理大数据量',
    validations: [
      (r) => ({ pass: r.analysisResult != null, reason: 'analysisResult 不应为空' }),
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        const fd = ar?.functionalDecomposition as unknown[] | undefined;
        const stories = ar?.userStories as unknown[] | undefined;
        const ac = ar?.acceptanceCriteria as unknown[] | undefined;
        return {
          pass: (Array.isArray(fd) && fd.length > 0) || (Array.isArray(stories) && stories.length > 0) || (Array.isArray(ac) && ac.length > 0),
          reason: '应至少产出功能分解、用户故事或验收标准中的一项（不含 fallback 建议）',
        };
      },
    ],
  },
  {
    name: 'B2: 带 REQ 编号 → 先查详情再分析',
    input: '分析需求 REQ-20240315-001，评估其技术方案',
    extracted: { title: '在线问卷系统', action: '开发在线问卷系统', constraints: ['3 个月上线'], entities: ['问卷', '用户'], priority: 'high' },
    validations: [
      (r) => ({ pass: r.analysisResult != null, reason: 'analysisResult 不应为空' }),
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        const fd = ar?.functionalDecomposition as unknown[] | undefined;
        const stories = ar?.userStories as unknown[] | undefined;
        const ac = ar?.acceptanceCriteria as unknown[] | undefined;
        return {
          pass: (Array.isArray(fd) && fd.length > 0) || (Array.isArray(stories) && stories.length > 0) || (Array.isArray(ac) && ac.length > 0),
          reason: '应至少产出功能分解、用户故事或验收标准中的一项（不含 fallback 建议）',
        };
      },
    ],
  },
  {
    name: 'B3: 登录/认证类需求 → 可触发冲突检测',
    input: '为 REQ-20240415-002 增加 SSO 单点登录和权限管理功能',
    extracted: { title: '认证模块', action: '增加 SSO', constraints: ['兼容 OAuth2.0'], entities: ['SSO', 'JWT'], priority: 'critical' },
    validations: [
      (r) => ({ pass: r.analysisResult != null, reason: 'analysisResult 不应为空' }),
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
        const deps = ar?.dependencies as { type?: string }[] | undefined;
        return {
          pass: deps?.some((d) => d.type === 'external' || d.type === 'internal') === true || ar?.functionalDecomposition != null,
          reason: '应包含冲突相关的依赖分析或功能分解',
        };
      },
    ],
  },
  {
    name: 'B4: 子图独立运行 — agent→tools→agent→finalize 路径',
    input: '分析需求：开发消息推送中心，支持多通道（短信、邮件、App Push）',
    extracted: { title: '消息推送', action: '开发消息推送中心', constraints: ['多通道'], entities: ['短信', '邮件'], priority: 'high' },
    validations: [
      (r) => ({ pass: r.analysisResult != null, reason: '子图独立运行应产出 analysisResult' }),
      (r) => {
        const ar = r.analysisResult as Record<string, unknown> | undefined;
 if (!ar) return { pass: false, reason: 'analysisResult 为空' };
        if (ar.parseError) return { pass: false, reason: 'JSON 解析错误' };
        const fd = ar.functionalDecomposition as unknown[] | undefined;
        const stories = ar.userStories as unknown[] | undefined;
        const ac = ar.acceptanceCriteria as unknown[] | undefined;
        return {
          pass: (Array.isArray(fd) && fd.length > 0) || (Array.isArray(stories) && stories.length > 0) || (Array.isArray(ac) && ac.length > 0),
          reason: '应至少产出功能分解、用户故事或验收标准中的一项',
        };
      },
      (r) => ({ pass: typeof r.messages === 'object', reason: '子图应保留 messages 历史' }),
    ],
  },
  {
    name: 'B5: 子图不触发无限制循环',
    input: '实现一个内部知识库系统，支持文档上传、全文检索、权限控制',
    validations: [
      (r) => ({ pass: r.analysisResult != null, reason: 'analysisResult 不为空即说明子图正常结束' }),
      (_, d) => ({ pass: d < 120000, reason: d >= 120000 ? `耗时 ${d}ms 过长` : undefined }),
    ],
  },
];

// ===============================================================
// Runners
// ===============================================================

async function runIntentCase(tc: TestCase): Promise<TestResult> {
  const start = performance.now();
  const result = await runAnalysisGraph(tc.input);
  const durationMs = Math.round(performance.now() - start);
  const validations = tc.validations.map((v) => v(result, durationMs));
  return {
    case: tc.name, passed: validations.every((v) => v.pass), durationMs,
    details: {
      input: tc.input, expectedIntent: tc.expectedIntent,
      intent: result.intent ?? '(none)', status: result.status,
      validations, usedAgents: result.usedAgents,
      toolLoopCount: result.toolLoopCount ?? 'n/a',
      reviseCount: result.reviseCount ?? 'n/a',
    },
  };
}

async function runReActCase(tc: ReActTestCase): Promise<TestResult> {
  const start = performance.now();
  const subgraph = createAnalysisSubGraph();
  const result = await subgraph.invoke({
    input: tc.input, extracted: tc.extracted ?? {}, clarified: tc.clarified ?? {},
    toolLoopCount: 0, messages: [],
  });
  const durationMs = Math.round(performance.now() - start);
  const validations = tc.validations.map((v) => v(result, durationMs));
  return {
    case: tc.name, passed: validations.every((v) => v.pass), durationMs,
    details: {
      input: tc.input, analysisResult: result.analysisResult,
      toolLoopCount: result.toolLoopCount ?? 0,
      messageCount: (result.messages as unknown[])?.length ?? 0,
      validations,
    },
  };
}

// ===============================================================
// Printers
// ===============================================================

function printIntentResult(r: TestResult) {
  const d = r.details;
  const icon = r.passed ? '✅' : '❌';
  console.log(`┌─ ${icon} ${r.case} ─ ${r.passed ? 'PASS' : 'FAIL'} (${r.durationMs}ms)`);
  console.log(`│  输入:        ${d.input}`);
  console.log(`│  期望意图:    ${d.expectedIntent}`);
  console.log(`│  实际意图:    ${d.intent}`);
  console.log(`│  状态:        ${d.status}`);
  console.log(`│  工具轮次:    ${d.toolLoopCount}`);
  console.log(`│  修订次数:    ${d.reviseCount}`);
  console.log(`│  路径:        [${(d.usedAgents as string[]).join(' → ')}]`);
  const failures = (d.validations as { pass: boolean; reason?: string }[]).filter((v) => !v.pass);
  if (failures.length > 0) { console.log(`│  失败项:`); for (const f of failures) console.log(`│    ↳ ${f.reason ?? '(unknown)'}`); }
  console.log('└──────────────────────────────────────────────────');
}

function printReActResult(r: TestResult) {
  const d = r.details;
  const icon = r.passed ? '✅' : '❌';
  console.log(`┌─ ${icon} ${r.case} ─ ${r.passed ? 'PASS' : 'FAIL'} (${r.durationMs}ms)`);
  console.log(`│  输入:          ${d.input}`);
  console.log(`│  工具轮次:      ${d.toolLoopCount}`);
  console.log(`│  messages 数:   ${d.messageCount}`);
  const ar = d.analysisResult as Record<string, unknown> | undefined;
  if (ar) {
    if (ar.parseError) console.log(`│  ⚠ JSON 解析失败`);
    if (ar._error) console.log(`│  ⚠ 错误: ${ar._error}`);
    console.log(`│  功能分解:      ${(ar.functionalDecomposition as unknown[])?.length ?? 0} 项`);
    console.log(`│  用户故事:      ${(ar.userStories as unknown[])?.length ?? 0} 条`);
    console.log(`│  验收标准:      ${(ar.acceptanceCriteria as unknown[])?.length ?? 0} 项`);
    console.log(`│  依赖关系:      ${(ar.dependencies as unknown[])?.length ?? 0} 项`);
    console.log(`│  改进建议:      ${(ar.suggestions as string[])?.length ?? 0} 条`);
    if (ar.technicalComplexity) console.log(`│  技术复杂度:    ${ar.technicalComplexity}`);
  }
  const failures = (d.validations as { pass: boolean; reason?: string }[]).filter((v) => !v.pass);
  if (failures.length > 0) { console.log(`│  失败项:`); for (const f of failures) console.log(`│    ↳ ${f.reason ?? '(unknown)'}`); }
  console.log('└──────────────────────────────────────────────────');
}

// ===============================================================
// Main
// ===============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  需求分析图集成测试 — Intent + ReAct + Critic      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log('── Part A: 意图分类（含 Critic-Refine 汇总子图）──\n');
  const intentResults: TestResult[] = [];
  for (const tc of INTENT_CASES) { const r = await runIntentCase(tc); intentResults.push(r); printIntentResult(r); }

  console.log('\n── Part B: ReAct 分析子图 ──\n');
  const reactResults: TestResult[] = [];
  for (const tc of REACT_CASES) { const r = await runReActCase(tc); reactResults.push(r); printReActResult(r); }

  const all = [...intentResults, ...reactResults];
  const passed = all.filter((r) => r.passed).length;
  const total = all.length;
  const ip = intentResults.filter((r) => r.passed).length;
  const rp = reactResults.filter((r) => r.passed).length;

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Part A (意图分类+Critic): ${ip}/${INTENT_CASES.length} 通过`);
  console.log(`  Part B (ReAct子图):       ${rp}/${REACT_CASES.length} 通过`);
  console.log(`  总计:                     ${passed}/${total} 通过`);
  console.log('══════════════════════════════════════════════════');
  for (const r of all) { console.log(`  ${r.passed ? '✅' : '❌'} ${r.case} (${r.durationMs}ms)`); }

  const intentOk = ip >= 6;
  const reactOk = rp >= 4;
  const accepted = intentOk && reactOk;
  console.log(accepted ? '\n✅ 验收通过' : `\n❌ 验收未通过 (PartA:${intentOk ? 'OK' : 'FAIL'} PartB:${reactOk ? 'OK' : 'FAIL'})`);
  process.exit(accepted ? 0 : 1);
}

main().catch((err) => { console.error('💥 测试执行异常:', err); process.exit(1); });
