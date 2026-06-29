/**
 * test-graph.ts — 需求分析图集成测试
 *
 * 验证意图分类 + 条件路由的正确性。
 * 运行方式：bun run services/chat/src/llm/graph/test-graph.ts
 *
 * 前置条件：LLM 配置（config/langchain.yaml + 环境变量）已就绪
 */

import { runAnalysisGraph, GraphOrchestrationResult } from './requirement-analysis-graph';

// ---------------------------------------------------------------
// 测试用例定义
// ---------------------------------------------------------------

interface TestCase {
  name: string;
  input: string;
  expectedIntent: 'analyze' | 'query' | 'chat';
  validations: ((result: GraphOrchestrationResult, durationMs: number) => {
    pass: boolean;
    reason?: string;
  })[];
}

const TEST_CASES: TestCase[] = [
  // -------------------------------------------------------
  // Case 1: 完整需求分析
  // -------------------------------------------------------
  {
    name: 'Case 1: 完整需求分析',
    input:
      '分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型（单选、多选、填空），支持问卷发布与数据统计，要求在 3 个月内上线',
    expectedIntent: 'analyze',
    validations: [
      (result) => ({
        pass: result.intent === 'analyze',
        reason: result.intent === 'analyze'
          ? undefined
          : `期望 intent=analyze，实际=${result.intent}`,
      }),
      (result) => ({
        pass: result.status === 'completed' || result.status === 'clarification_needed',
        reason: `status=${result.status}`,
      }),
      (result) => ({
        pass: result.steps.some((s) => s.agent === 'extractStep'),
        reason: 'extractStep 未触发（分析链未启动）',
      }),
      (result) => ({
        pass:
          result.steps.some((s) => s.agent === 'summaryStep') ||
          result.status === 'clarification_needed',
        reason:
          result.status === 'clarification_needed'
            ? undefined
            : 'summaryStep 未触发（分析链未完成）',
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 2: 需求状态查询
  // -------------------------------------------------------
  {
    name: 'Case 2: 需求状态查询',
    input: '查询 REQ-20240315-001 的当前状态',
    expectedIntent: 'query',
    validations: [
      (result) => ({
        pass: result.intent === 'query',
        reason: `期望 intent=query，实际=${result.intent}`,
      }),
      (result) => ({
        pass: (result.queryResponse ?? '').length > 0,
        reason: 'queryResponse 为空',
      }),
      (result) => ({
        pass: !result.steps.some((s) => s.agent === 'analysisStep'),
        reason: 'analysisStep 不应触发（query 路径）',
      }),
      (result) => ({
        pass: !result.steps.some((s) => s.agent === 'riskStep'),
        reason: 'riskStep 不应触发（query 路径）',
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 3: 普通闲聊
  // -------------------------------------------------------
  {
    name: 'Case 3: 普通闲聊',
    input: '你好，今天天气不错',
    expectedIntent: 'chat',
    validations: [
      (result) => ({
        pass: result.intent === 'chat',
        reason: `期望 intent=chat，实际=${result.intent}`,
      }),
      (result) => ({
        pass: (result.chatResponse ?? '').length > 0,
        reason: 'chatResponse 为空',
      }),
      (result, durationMs) => ({
        pass: durationMs < 5000,
        reason: `响应时间 ${durationMs}ms ≥ 5000ms`,
      }),
      (result) => ({
        pass: !result.steps.some((s) => s.agent === 'extractStep'),
        reason: 'extractStep 不应触发（chat 路径）',
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 4: 模糊意图
  // -------------------------------------------------------
  {
    name: 'Case 4: 模糊意图',
    input: '看看 REQ-20240315-001 有没有什么问题',
    expectedIntent: 'analyze', // 允许 analyze 或 query
    validations: [
      (result) => ({
        pass: result.intent === 'analyze' || result.intent === 'query',
        reason: `intent 应为 analyze 或 query，实际=${result.intent}`,
      }),
      (result) => ({
        pass: result.status !== 'failed',
        reason: `status=${result.status}，不应失败`,
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 5: 带编号的查询
  // -------------------------------------------------------
  {
    name: 'Case 5: 带编号的查询（需求编号优先）',
    input: 'REQ-20240415-002 的进度如何',
    expectedIntent: 'query',
    validations: [
      (result) => ({
        pass: result.intent === 'query',
        reason: `有需求编号应判为 query，实际=${result.intent}`,
      }),
      (result) => ({
        pass: result.steps.some((s) => s.agent === 'queryHandler'),
        reason: 'queryHandler 未触发',
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 6: 简短需求
  // -------------------------------------------------------
  {
    name: 'Case 6: 简短需求分析',
    input: '我需要一个用户登录功能',
    expectedIntent: 'analyze',
    validations: [
      (result) => ({
        pass: result.intent === 'analyze',
        reason: `期望 intent=analyze，实际=${result.intent}`,
      }),
      (result) => ({
        pass: result.steps.some((s) => s.agent === 'extractStep'),
        reason: 'extractStep 未触发（分析链未启动）',
      }),
      (result) => ({
        pass:
          result.steps.some((s) => s.agent === 'summaryStep') ||
          result.status === 'clarification_needed',
        reason: result.status === 'clarification_needed'
          ? undefined
          : 'summaryStep 未触发（分析链未完成）',
      }),
    ],
  },

  // -------------------------------------------------------
  // Case 7: 多重含义（"查询" + "分析"）
  // -------------------------------------------------------
  {
    name: 'Case 7: 多重含义（查询动词优先）',
    input: '查询 REQ-20240315-001 的风险分析报告',
    expectedIntent: 'query',
    validations: [
      (result) => ({
        pass: result.intent === 'query',
        reason: `"查询"动词+需求编号应判为 query，实际=${result.intent}`,
      }),
      (result) => ({
        pass: (result.queryResponse ?? '').length > 0,
        reason: 'queryResponse 为空',
      }),
      (result) => ({
        pass: !result.steps.some((s) => s.agent === 'analysisStep'),
        reason: 'analysisStep 不应在 query 路径触发',
      }),
    ],
  },
];

// ---------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------

interface TestResult {
  case: string;
  passed: boolean;
  durationMs: number;
  details: {
    intent: string;
    status: string;
    validations: { pass: boolean; reason?: string }[];
    usedAgents: string[];
  };
}

async function runTestCase(tc: TestCase): Promise<TestResult> {
  const start = performance.now();
  const result = await runAnalysisGraph(tc.input);
  const durationMs = Math.round(performance.now() - start);

  const validations = tc.validations.map((v) => v(result, durationMs));
  const passed = validations.every((v) => v.pass);

  return {
    case: tc.name,
    passed,
    durationMs,
    details: {
      intent: result.intent ?? '(none)',
      status: result.status,
      validations,
      usedAgents: result.usedAgents,
    },
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   需求分析图集成测试 — Intent Classification      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const results: TestResult[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const r = await runTestCase(tc);
    results.push(r);

    const icon = r.passed ? '✅' : '❌';
    const statusLine = r.passed ? 'PASS' : 'FAIL';

    console.log(`┌─ ${icon} ${tc.name} ─ ${statusLine} (${r.durationMs}ms)`);
    console.log(`│  输入:      ${tc.input}`);
    console.log(`│  期望意图:  ${tc.expectedIntent}`);
    console.log(`│  实际意图:  ${r.details.intent}`);
    console.log(`│  状态:      ${r.details.status}`);
    console.log(`│  路径:      [${r.details.usedAgents.join(' → ')}]`);

    // 失败时展示不通过的验证项
    const failures = r.details.validations.filter((v) => !v.pass);
    if (failures.length > 0) {
      console.log(`│  失败项:`);
      for (const f of failures) {
        console.log(`│    ↳ ${f.reason ?? '(unknown)'}`);
      }
    }
    console.log('└──────────────────────────────────────────────────');
  }

  // -------------------------------------------------------
  // Summary
  // -------------------------------------------------------
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const accuracy = ((passed / total) * 100).toFixed(0);

  console.log(`\n  结果: ${passed}/${total} 通过 | 准确率: ${accuracy}%\n`);

  // 验收判定
  const ACCEPTANCE_THRESHOLD = 6;
  const accepted = passed >= ACCEPTANCE_THRESHOLD;

  console.log(
    accepted
      ? '✅ 验收通过：意图分类准确率 ≥ 85%'
      : '❌ 验收未通过：意图分类准确率 < 85%',
  );

  process.exit(accepted ? 0 : 1);
}

main().catch((err) => {
  console.error('💥 测试执行异常:', err);
  process.exit(1);
});
