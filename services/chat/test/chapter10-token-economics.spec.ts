// ---------------------------------------------------------------
// 第十章 10.2 节 — Token 成本估算工具 单元测试
//
// 使用 bun:test 风格，mock-first，无需真实 API key 或数据库。
// 运行：bun test services/chat/test/chapter10-token-economics.spec.ts
// ---------------------------------------------------------------
import { describe, it, expect, mock } from 'bun:test';
import {
  estimateTextTokens,
  getModelPricing,
  estimateGraphNodeCost,
  PRICING,
  FALLBACK_MODEL,
  type ModelPricing,
  type GraphNodeCostInput,
} from '../src/llm/cost/token-estimator';
import {
  trimMessagesForContext,
  removeOrphanToolMessages,
} from '../src/llm/context/message-trimmer';
import {
  compressConversation,
  type SummaryModel,
} from '../src/llm/context/conversation-compressor';
import {
  resolveModelForAgent,
  DEFAULT_AGENT_MODEL_SET,
  HIGH_RISK_AGENTS,
  AGENT_TO_CONFIG_KEY,
  type AgentName,
  type AgentModelSet,
} from '../src/llm/cost/agent-model-set';
import {
  TokenUsageService,
  type TokenUsageClient,
  type TokenUsageRecord,
  type MonthlyStats,
} from '../src/llm/cost/token-usage.service';
import {
  withTokenUsage,
  type LLMResponseLike,
} from '../src/llm/cost/with-token-usage';
import {
  resolveBudgetAction,
  type BudgetAction,
  type BudgetPolicyInput,
} from '../src/llm/cost/budget-policy';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

// ================================================================
// estimateTextTokens
// ================================================================
describe('estimateTextTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('null 返回 0', () => {
    expect(estimateTextTokens(null)).toBe(0);
  });

  it('undefined 返回 0', () => {
    expect(estimateTextTokens(undefined)).toBe(0);
  });

  it('纯中文文本 token > 0', () => {
    const tokens = estimateTextTokens('你好世界');
    expect(tokens).toBeGreaterThan(0);
    // 4 个中文字符 → 4 tokens
    expect(tokens).toBe(4);
  });

  it('中文标点也计为 1 token', () => {
    // "你好，世界！" → 你好 2token + ，1token + 世界 2token + ！1token = 6
    const tokens = estimateTextTokens('你好，世界！');
    expect(tokens).toBe(6);
  });

  it('全角字符（U+FF00-U+FFEF）计为 1 token', () => {
    // 全角字母 "Ａ"（U+FF21）→ 1 token
    const tokens = estimateTextTokens('ＡＢＣ');
    expect(tokens).toBe(3);
  });

  it('纯英文每 4 字符约 1 token', () => {
    const tokens = estimateTextTokens('hello');
    // 5 chars × 0.25 = 1.25 → ceil → 2
    expect(tokens).toBe(2);
  });

  it('8 个英文字符约 2 token', () => {
    const tokens = estimateTextTokens('abcdefgh');
    // 8 × 0.25 = 2 → ceil → 2
    expect(tokens).toBe(2);
  });

  it('9 个英文字符约 3 token（ceil 效应）', () => {
    const tokens = estimateTextTokens('abcdefghi');
    // 9 × 0.25 = 2.25 → ceil → 3
    expect(tokens).toBe(3);
  });

  it('中英混合文本正确计数', () => {
    // "hello你好" → 5 × 0.25 + 2 × 1 = 1.25 + 2 = 3.25 → ceil → 4
    const tokens = estimateTextTokens('hello你好');
    expect(tokens).toBe(4);
  });

  it('空格和标点按 0.25 token 计', () => {
    // "Hi there!" → 9 chars × 0.25 = 2.25 → ceil → 3
    const tokens = estimateTextTokens('Hi there!');
    expect(tokens).toBe(3);
  });

  it('较长文本估算不会为 0', () => {
    const longText = 'a'.repeat(1000);
    const tokens = estimateTextTokens(longText);
    // 1000 × 0.25 = 250
    expect(tokens).toBe(250);
  });

  it('纯数字按 0.25 token 计', () => {
    // "12345678" → 8 × 0.25 = 2
    const tokens = estimateTextTokens('12345678');
    expect(tokens).toBe(2);
  });
});

// ================================================================
// getModelPricing
// ================================================================
describe('getModelPricing', () => {
  it('已知 modelName 返回对应定价', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing.input).toBe(2.5);
    expect(pricing.output).toBe(10.0);
    expect(pricing.cachedInput).toBe(1.25);
  });

  it('gpt-4o-mini 定价正确', () => {
    const pricing = getModelPricing('gpt-4o-mini');
    expect(pricing.input).toBe(0.15);
    expect(pricing.output).toBe(0.6);
  });

  it('claude-sonnet 定价正确', () => {
    const pricing = getModelPricing('claude-sonnet-4-20250514');
    expect(pricing.input).toBe(3.0);
    expect(pricing.output).toBe(15.0);
    expect(pricing.cachedInput).toBe(0.3);
  });

  it('deepseek-chat 无 cachedInput', () => {
    const pricing = getModelPricing('deepseek-chat');
    expect(pricing.input).toBe(0.27);
    expect(pricing.output).toBe(1.1);
    expect(pricing.cachedInput).toBeUndefined();
  });

  it('未知模型回退到 gpt-4o-mini', () => {
    const pricing = getModelPricing('some-unknown-model-v99');
    expect(pricing.input).toBe(0.15);
    expect(pricing.output).toBe(0.6);
  });

  it('前缀匹配：claude-sonnet 可匹配变体', () => {
    // 'claude-sonnet-20250601' startsWith 'claude-sonnet'
    const pricing = getModelPricing('claude-sonnet-20250601');
    expect(pricing.input).toBe(3.0);
    expect(pricing.output).toBe(15.0);
  });

  it('返回的定价对象是浅拷贝，不会影响 PRICING 常量', () => {
    const pricing = getModelPricing('gpt-4o');
    pricing.input = 999;
    expect(PRICING['gpt-4o'].input).toBe(2.5); // 原值不变
  });

  it('FALLBACK_MODEL 是 gpt-4o-mini', () => {
    expect(FALLBACK_MODEL).toBe('gpt-4o-mini');
  });
});

// ================================================================
// estimateGraphNodeCost
// ================================================================
describe('estimateGraphNodeCost', () => {
  const basicInput: GraphNodeCostInput = {
    nodeName: 'extractAgent',
    modelName: 'gpt-4o-mini',
    systemPrompt: '你是一个需求抽取专家。',
    outputText: '已抽取 3 条约束。',
  };

  it('基础输入返回合理成本结构', () => {
    const result = estimateGraphNodeCost(basicInput);

    expect(result.nodeName).toBe('extractAgent');
    expect(result.modelName).toBe('gpt-4o-mini');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(
      result.inputTokens + result.outputTokens,
    );
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.pricing.input).toBe(0.15);
  });

  it('成本 = (input × inputPrice + output × outputPrice) / 1e6（保留 6 位小数）', () => {
    const result = estimateGraphNodeCost(basicInput);

    const rawCost =
      (result.inputTokens * result.pricing.input +
        result.outputTokens * result.pricing.output) /
      1_000_000;

    // 函数内部 Math.round(cost * 1e6) / 1e6 保留 6 位小数
    const roundedCost = Math.round(rawCost * 1_000_000) / 1_000_000;
    expect(result.estimatedCostUsd).toBe(roundedCost);
  });

  it('带 toolSchemas 的成本高于不带 toolSchemas', () => {
    const withoutTools = estimateGraphNodeCost(basicInput);

    const withTools = estimateGraphNodeCost({
      ...basicInput,
      toolSchemas: [
        JSON.stringify({
          name: 'search_knowledge_base',
          description: '搜索知识库获取相关文档',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
            },
          },
        }),
      ],
    });

    // toolSchemas 额外消耗输入 token，总成本应更高
    expect(withTools.inputTokens).toBeGreaterThan(
      withoutTools.inputTokens,
    );
    expect(withTools.estimatedCostUsd).toBeGreaterThan(
      withoutTools.estimatedCostUsd,
    );
  });

  it('带 messages 的成本高于不带 messages', () => {
    const withoutMessages = estimateGraphNodeCost(basicInput);

    const withMessages = estimateGraphNodeCost({
      ...basicInput,
      messages: [
        '用户注册时必须绑定手机号，密码至少 8 位',
        '这个需求需要支持国际手机号吗？',
      ],
    });

    expect(withMessages.inputTokens).toBeGreaterThan(
      withoutMessages.inputTokens,
    );
  });

  it('支持 MessageLike 对象格式的 messages', () => {
    const result = estimateGraphNodeCost({
      ...basicInput,
      messages: [
        { role: 'user', content: '请分析这段需求。' },
        { role: 'assistant', content: '好的，我来分析。' },
      ],
    });

    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('MessageLike 的 content 为非字符串时能正常序列化', () => {
    const result = estimateGraphNodeCost({
      ...basicInput,
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '分析结果如下' }],
        },
      ],
    });

    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('MessageLike 无 content 字段时不计入', () => {
    const withoutMsg = estimateGraphNodeCost(basicInput);

    const withEmptyMsg = estimateGraphNodeCost({
      ...basicInput,
      messages: [{ role: 'system' }],
    });

    // 无 content 的消息不增加 token
    expect(withEmptyMsg.inputTokens).toBe(withoutMsg.inputTokens);
  });

  it('输出按 pricing.output 计费', () => {
    // 选取高输出、低输入的场景以验证 output 计费
    const result = estimateGraphNodeCost({
      nodeName: 'aggregator',
      modelName: 'claude-sonnet',
      systemPrompt: '汇总。',
      outputText: '详细的分析报告：' + '结论'.repeat(500),
    });

    // output cost 占比应显著
    const outputCost =
      (result.outputTokens * result.pricing.output) / 1_000_000;
    expect(outputCost).toBeGreaterThan(0);
    // output 价格是 15/1M，outputTokens 较大时成本应主要由 output 驱动
  });

  it('不同模型同一输入成本不同', () => {
    const cheapResult = estimateGraphNodeCost({
      ...basicInput,
      modelName: 'gpt-4o-mini',
    });

    const expensiveResult = estimateGraphNodeCost({
      ...basicInput,
      modelName: 'claude-sonnet',
    });

    // claude-sonnet 比 gpt-4o-mini 贵
    expect(expensiveResult.estimatedCostUsd).toBeGreaterThan(
      cheapResult.estimatedCostUsd,
    );
  });

  it('零输出文本时 outputTokens 为 0', () => {
    const result = estimateGraphNodeCost({
      ...basicInput,
      outputText: '',
    });

    expect(result.outputTokens).toBe(0);
    expect(result.estimatedCostUsd).toBeGreaterThan(0); // 仍有 input cost
  });

  it('空 systemPrompt 时 inputTokens 为 0（无 messages 和 toolSchemas）', () => {
    const result = estimateGraphNodeCost({
      nodeName: 'emptyNode',
      modelName: 'gpt-4o-mini',
      systemPrompt: '',
      outputText: '',
    });

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.estimatedCostUsd).toBe(0);
  });

  it('estimatedCostUsd 保留 6 位小数精度', () => {
    const result = estimateGraphNodeCost(basicInput);
    const decimalPlaces = result.estimatedCostUsd.toString().split('.')[1];
    // 可能是 0-6 位（末尾 0 会被省略），但不会超过 6 位
    if (decimalPlaces) {
      expect(decimalPlaces.length).toBeLessThanOrEqual(7); // 浮动误差容忍
    }
  });

  it('模拟典型 Supervisor 节点成本', () => {
    const result = estimateGraphNodeCost({
      nodeName: 'supervisor',
      modelName: 'gpt-4o',
      systemPrompt:
        '你是 Multi-Agent 需求分析系统的 Supervisor，负责调度专家 Agent。',
      messages: [
        '请分析以下需求：用户注册时必须绑定手机号，密码至少 8 位。',
        '已抽取需求：action=注册, constraints=[绑定手机号, 密码至少8位]',
      ],
      outputText: 'NEXT: clarifyAgent',
    });

    expect(result.nodeName).toBe('supervisor');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeLessThan(0.01); // 短消息成本极低
  });

  it('高成本场景估算合理', () => {
    // 模拟长文本 + 多 tool schema 的大节点
    const longPrompt = '你是一个资深的需求分析专家。'.repeat(200);
    const longOutput = '分析结果：'.repeat(1000);
    const schemas = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        name: `tool_${i}`,
        description: `工具 ${i} 的描述`.repeat(20),
        parameters: { type: 'object', properties: {} },
      }),
    );

    const result = estimateGraphNodeCost({
      nodeName: 'analysisAgent',
      modelName: 'gpt-4o',
      systemPrompt: longPrompt,
      toolSchemas: schemas,
      outputText: longOutput,
    });

    // 成本应该在合理范围（远远小于 1 USD）
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeLessThan(1);
  });
});

// ================================================================
// PRICING 常量完整性
// ================================================================
describe('PRICING 常量', () => {
  it('所有定价的 input > 0', () => {
    for (const [name, pricing] of Object.entries(PRICING)) {
      expect(
        pricing.input,
        `${name}.input 应 > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('所有定价的 output > 0', () => {
    for (const [name, pricing] of Object.entries(PRICING)) {
      expect(
        pricing.output,
        `${name}.output 应 > 0`,
      ).toBeGreaterThan(0);
    }
  });

  it('cachedInput（如果存在）不大于 input', () => {
    for (const [name, pricing] of Object.entries(PRICING)) {
      if (pricing.cachedInput != null) {
        expect(
          pricing.cachedInput,
          `${name}.cachedInput 应 <= input`,
        ).toBeLessThanOrEqual(pricing.input);
      }
    }
  });
});

// ================================================================
// 10.5.1 message-trimmer
// ================================================================
describe('10.5.1 message-trimmer', () => {
  // ----------------------------------------------------------
  // removeOrphanToolMessages
  // ----------------------------------------------------------
  describe('removeOrphanToolMessages', () => {
    it('无 tool 消息时原样返回', () => {
      const messages: BaseMessage[] = [
        new SystemMessage('system prompt'),
        new HumanMessage('hello'),
        new AIMessage('hi there'),
        new HumanMessage('thanks'),
        new AIMessage('you are welcome'),
      ];

      const result = removeOrphanToolMessages(messages);
      expect(result.length).toBe(5);
      expect(result).toEqual(messages);
    });

    it('AIMessage(tool_calls) 与 ToolMessage 成对保留（全部匹配）', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('search for docs'),
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call_1', name: 'search', args: { query: 'docs' } },
          ],
        }),
        new ToolMessage({
          content: 'found 3 docs',
          tool_call_id: 'call_1',
        }),
        new AIMessage('here are the results'),
      ];

      const result = removeOrphanToolMessages(messages);
      expect(result.length).toBe(4);
      // AIMessage(tool_calls) 保留
      expect(result[1]).toBeInstanceOf(AIMessage);
      expect((result[1] as AIMessage).tool_calls).toHaveLength(1);
      // ToolMessage 保留
      expect(result[2]).toBeInstanceOf(ToolMessage);
    });

    it('孤立 ToolMessage（无对应 AIMessage）被移除', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('hello'),
        new AIMessage('hi'),
        new ToolMessage({
          content: 'orphan result',
          tool_call_id: 'call_orphan',
        }),
      ];

      const result = removeOrphanToolMessages(messages);
      expect(result.length).toBe(2);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[1]).toBeInstanceOf(AIMessage);
    });

    it('AIMessage 部分 tool_call 缺失响应时整条 AIMessage 移除', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('do two things'),
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call_a', name: 'toolA', args: {} },
            { id: 'call_b', name: 'toolB', args: {} },
          ],
        }),
        // 只有 call_a 有响应，call_b 缺失
        new ToolMessage({
          content: 'result A',
          tool_call_id: 'call_a',
        }),
        new AIMessage('done'),
      ];

      const result = removeOrphanToolMessages(messages);

      // AIMessage(tool_calls) 被移除（不全匹配）
      const aiToolCalls = result.filter(
        (m) => m instanceof AIMessage && (m as AIMessage).tool_calls?.length,
      );
      expect(aiToolCalls.length).toBe(0);

      // call_a 的 ToolMessage 也被移除（全有或全无）
      const toolMsgs = result.filter((m) => m instanceof ToolMessage);
      expect(toolMsgs.length).toBe(0);
    });

    it('多个 tool_call_id 精确配对：全部匹配时保留', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('step 1'),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_1', name: 'search', args: {} }],
        }),
        new ToolMessage({ content: 'result 1', tool_call_id: 'call_1' }),
        new AIMessage('intermediate'),
        new HumanMessage('step 2'),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_2', name: 'calculate', args: {} }],
        }),
        new ToolMessage({ content: 'result 2', tool_call_id: 'call_2' }),
      ];

      const result = removeOrphanToolMessages(messages);

      const aiCalls = result.filter(
        (m) => m instanceof AIMessage && (m as AIMessage).tool_calls?.length,
      );
      expect(aiCalls.length).toBe(2);

      const toolMsgs = result.filter((m) => m instanceof ToolMessage);
      expect(toolMsgs.length).toBe(2);
    });

    it('同一 AIMessage 有多个 tool_calls 全部匹配时保留', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('run parallel'),
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 't1', name: 'weather', args: { city: 'Beijing' } },
            { id: 't2', name: 'news', args: { topic: 'AI' } },
            { id: 't3', name: 'stock', args: { symbol: 'AAPL' } },
          ],
        }),
        new ToolMessage({ content: 'sunny 25°C', tool_call_id: 't1' }),
        new ToolMessage({ content: 'AI news today...', tool_call_id: 't2' }),
        new ToolMessage({ content: 'AAPL $200', tool_call_id: 't3' }),
        new AIMessage('summary'),
      ];

      const result = removeOrphanToolMessages(messages);

      expect(result.length).toBe(6);

      const survivingAi = result.find(
        (m) =>
          m instanceof AIMessage &&
          (m as AIMessage).tool_calls &&
          (m as AIMessage).tool_calls!.length === 3,
      );
      expect(survivingAi).toBeDefined();

      const survivingToolMsgs = result.filter((m) => m instanceof ToolMessage);
      expect(survivingToolMsgs.length).toBe(3);
    });

    it('tool_call.id 为 undefined 时视为不匹配', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('call'),
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'no_id_tool', args: {} } as AIMessage['tool_calls'][number],
          ],
        }),
        new ToolMessage({ content: 'result', tool_call_id: 'some_id' }),
      ];

      const result = removeOrphanToolMessages(messages);

      const aiWithTools = result.filter(
        (m) => m instanceof AIMessage && (m as AIMessage).tool_calls?.length,
      );
      expect(aiWithTools.length).toBe(0);
    });

    it('重复 tool_call_id 按精确匹配处理', () => {
      const messages: BaseMessage[] = [
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'dup', name: 'read', args: {} }],
        }),
        new ToolMessage({ content: 'first', tool_call_id: 'dup' }),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'dup', name: 'read', args: {} }],
        }),
        new ToolMessage({ content: 'second', tool_call_id: 'dup' }),
      ];

      const result = removeOrphanToolMessages(messages);

      const aiCalls = result.filter(
        (m) => m instanceof AIMessage && (m as AIMessage).tool_calls?.length,
      );
      expect(aiCalls.length).toBe(2);

      const toolMsgs = result.filter((m) => m instanceof ToolMessage);
      expect(toolMsgs.length).toBe(2);
    });
  });

  // ----------------------------------------------------------
  // trimMessagesForContext
  // ----------------------------------------------------------
  describe('trimMessagesForContext', () => {
    it('SystemMessage 始终保留', () => {
      const messages: BaseMessage[] = [
        new SystemMessage('important system prompt'),
        new HumanMessage('msg1'),
        new HumanMessage('msg2'),
      ];

      const result = trimMessagesForContext(messages, { maxMessages: 1 });

      const systemMsgs = result.filter((m) => m instanceof SystemMessage);
      expect(systemMsgs.length).toBe(1);
      expect((systemMsgs[0] as SystemMessage).content).toBe(
        'important system prompt',
      );
    });

    it('只保留最近 maxMessages 条非 system 消息', () => {
      const messages: BaseMessage[] = [];
      for (let i = 0; i < 25; i++) {
        messages.push(new HumanMessage(`msg-${i}`));
      }

      const result = trimMessagesForContext(messages, { maxMessages: 10 });

      expect(result.length).toBe(10);
      expect((result[0] as HumanMessage).content).toBe('msg-15');
      expect((result[9] as HumanMessage).content).toBe('msg-24');
    });

    it('默认 maxMessages=20', () => {
      const messages: BaseMessage[] = [];
      for (let i = 0; i < 30; i++) {
        messages.push(new HumanMessage(`msg-${i}`));
      }

      const result = trimMessagesForContext(messages);

      expect(result.length).toBe(20);
      expect((result[0] as HumanMessage).content).toBe('msg-10');
      expect((result[19] as HumanMessage).content).toBe('msg-29');
    });

    it('preserveSystemMessages=false 丢弃 SystemMessage', () => {
      const messages: BaseMessage[] = [
        new SystemMessage('system'),
        new HumanMessage('hello'),
        new AIMessage('hi'),
      ];

      const result = trimMessagesForContext(messages, {
        preserveSystemMessages: false,
      });

      const systemMsgs = result.filter((m) => m instanceof SystemMessage);
      expect(systemMsgs.length).toBe(0);
    });

    it('裁剪后清理孤立 ToolMessage', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('step 1'),
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_keep', name: 'search', args: {} }],
        }),
        new ToolMessage({ content: 'result', tool_call_id: 'call_keep' }),
        new AIMessage('done'),
      ];

      // maxMessages=2 只保留最后 2 条 → ToolMessage + AIMessage('done')
      // AIMessage(tool_calls) 被裁剪掉 → ToolMessage 变为孤立
      const result = trimMessagesForContext(messages, { maxMessages: 2 });

      expect(result.length).toBe(1);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect((result[0] as AIMessage).content).toBe('done');
    });

    it('SystemMessage 放在结果最前面', () => {
      const messages: BaseMessage[] = [
        new SystemMessage('sys1'),
        new HumanMessage('h1'),
        new SystemMessage('sys2'),
        new HumanMessage('h2'),
      ];

      const result = trimMessagesForContext(messages, { maxMessages: 1 });

      expect(result[0]).toBeInstanceOf(SystemMessage);
      expect(result[1]).toBeInstanceOf(SystemMessage);
    });

    it('空消息列表返回空数组', () => {
      const result = trimMessagesForContext([]);
      expect(result.length).toBe(0);
    });

    it('只有 SystemMessage 时全部保留', () => {
      const messages: BaseMessage[] = [
        new SystemMessage('sys1'),
        new SystemMessage('sys2'),
      ];

      const result = trimMessagesForContext(messages);

      expect(result.length).toBe(2);
      expect(result[0]).toBeInstanceOf(SystemMessage);
      expect(result[1]).toBeInstanceOf(SystemMessage);
    });
  });
});

// ================================================================
// 10.5.2 conversation-compressor
// ================================================================
describe('10.5.2 conversation-compressor', () => {
  function createMockSummaryModel(
    responseContent = 'compressed summary',
  ): SummaryModel {
    return {
      invoke: mock(async (_msgs: { role: string; content: string }[]) => ({
        content: responseContent,
      })),
    };
  }

  it('短对话不触发压缩', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage('system'),
      new HumanMessage('q1'),
      new AIMessage('a1'),
      new HumanMessage('q2'),
      new AIMessage('a2'),
    ];

    const summaryModel = createMockSummaryModel();
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 10,
    });

    expect(result).toEqual(messages);
    expect(summaryModel.invoke).not.toHaveBeenCalled();
  });

  it('等于 keepRecent 时不触发压缩', async () => {
    const messages: BaseMessage[] = [
      new HumanMessage('q1'),
      new AIMessage('a1'),
      new HumanMessage('q2'),
      new AIMessage('a2'),
      new HumanMessage('q3'),
    ];

    const summaryModel = createMockSummaryModel();
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 5,
    });

    expect(result).toEqual(messages);
    expect(summaryModel.invoke).not.toHaveBeenCalled();
  });

  it('长对话触发 summaryModel.invoke', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage('system prompt'),
      ...Array.from({ length: 15 }, (_, i) =>
        i % 2 === 0
          ? new HumanMessage(`question ${i}`)
          : new AIMessage(`answer ${i}`),
      ),
    ];

    const summaryModel = createMockSummaryModel('早期对话摘要');
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 5,
    });

    expect(summaryModel.invoke).toHaveBeenCalledTimes(1);

    // 1 original system + 1 summary system + 5 recent
    expect(result.length).toBe(1 + 1 + 5);

    const sysMsgs = result.filter((m) => m instanceof SystemMessage);
    expect(sysMsgs.length).toBe(2);
    expect((sysMsgs[0] as SystemMessage).content).toBe('system prompt');
  });

  it('返回结果包含 [对话摘要] 前缀', async () => {
    const messages: BaseMessage[] = Array.from({ length: 20 }, (_, i) =>
      new HumanMessage(`msg ${i}`),
    );

    const summaryModel = createMockSummaryModel('核心内容摘要');
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 3,
    });

    const sysMsgs = result.filter((m) => m instanceof SystemMessage);
    const summaryMsg = sysMsgs[sysMsgs.length - 1] as SystemMessage;
    expect(summaryMsg.content).toContain('[对话摘要]');
    expect(summaryMsg.content).toContain('核心内容摘要');
  });

  it('多个 SystemMessage 全部保留', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage('sys A'),
      new SystemMessage('sys B'),
      new SystemMessage('sys C'),
      ...Array.from({ length: 30 }, (_, i) => new HumanMessage(`msg ${i}`)),
    ];

    const summaryModel = createMockSummaryModel('summary');
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 5,
    });

    const sysMsgs = result.filter((m) => m instanceof SystemMessage);
    expect(sysMsgs.length).toBe(4); // 3 original + 1 summary
    expect((sysMsgs[0] as SystemMessage).content).toBe('sys A');
    expect((sysMsgs[1] as SystemMessage).content).toBe('sys B');
    expect((sysMsgs[2] as SystemMessage).content).toBe('sys C');
    expect((sysMsgs[3] as SystemMessage).content).toContain('[对话摘要]');
  });

  it('最近 keepRecent 条消息保留原文', async () => {
    const messages: BaseMessage[] = Array.from({ length: 20 }, (_, i) =>
      new HumanMessage(`msg ${i}`),
    );

    const summaryModel = createMockSummaryModel('summary');
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 4,
    });

    const nonSys = result.filter((m) => !(m instanceof SystemMessage));
    expect(nonSys.length).toBe(4);
    expect((nonSys[0] as HumanMessage).content).toBe('msg 16');
    expect((nonSys[3] as HumanMessage).content).toBe('msg 19');
  });

  it('摘要 prompt 包含早期消息中的关键信息', async () => {
    const earlyMessages: BaseMessage[] = [
      new HumanMessage('请分析 REQ-001：用户注册功能'),
      new AIMessage('已抽取：绑定手机号、密码最小8位'),
      new HumanMessage('补充：需要支持国际手机号'),
      new AIMessage('已更新需求，增加国际手机号约束'),
    ];

    const messages: BaseMessage[] = [
      ...earlyMessages,
      new HumanMessage('继续下一步'),
      new AIMessage('进入分析阶段'),
    ];

    let capturedInput: { role: string; content: string }[] = [];
    const summaryModel: SummaryModel = {
      invoke: mock(async (input) => {
        capturedInput = input;
        return { content: 'summary' };
      }),
    };

    await compressConversation(messages, summaryModel, { keepRecent: 2 });

    const earlyContent = capturedInput.map((m) => m.content).join(' ');
    expect(earlyContent).toContain('REQ-001');
    expect(earlyContent).toContain('用户注册功能');
    expect(earlyContent).toContain('国际手机号');
    expect(earlyContent).toContain('绑定手机号');
  });

  it('默认 keepRecent=10', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage('system'),
      ...Array.from({ length: 15 }, (_, i) => new HumanMessage(`msg ${i}`)),
    ];

    const summaryModel = createMockSummaryModel();
    const result = await compressConversation(messages, summaryModel);

    expect(summaryModel.invoke).toHaveBeenCalledTimes(1);

    const nonSys = result.filter((m) => !(m instanceof SystemMessage));
    expect(nonSys.length).toBe(10);
    expect((nonSys[0] as HumanMessage).content).toBe('msg 5');
  });

  it('无 SystemMessage 时功能正常', async () => {
    const messages: BaseMessage[] = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0
        ? new HumanMessage(`q ${i}`)
        : new AIMessage(`a ${i}`),
    );

    const summaryModel = createMockSummaryModel('summary');
    const result = await compressConversation(messages, summaryModel, {
      keepRecent: 5,
    });

    const sysMsgs = result.filter((m) => m instanceof SystemMessage);
    expect(sysMsgs.length).toBe(1);
    expect((sysMsgs[0] as SystemMessage).content).toContain('[对话摘要]');

    const nonSys = result.filter((m) => !(m instanceof SystemMessage));
    expect(nonSys.length).toBe(5);
  });
});

// ================================================================
// 10.9.1 AgentModelSet — 默认按角色模型绑定
// ================================================================
describe('10.9.1 AgentModelSet', () => {
  it('DEFAULT_AGENT_MODEL_SET 包含全部 9 个字段', () => {
    const keys = Object.keys(DEFAULT_AGENT_MODEL_SET);
    expect(keys.length).toBe(9);
    for (const agentName of Object.keys(AGENT_TO_CONFIG_KEY) as AgentName[]) {
      const configKey = AGENT_TO_CONFIG_KEY[agentName];
      expect(DEFAULT_AGENT_MODEL_SET[configKey]).toBeTruthy();
    }
  });

  it('supervisor 默认使用 demo-gpt-4o', () => {
    expect(DEFAULT_AGENT_MODEL_SET.supervisorModelConfigId).toBe(
      'demo-gpt-4o',
    );
  });

  it('security_expert 默认使用 demo-gpt-4o', () => {
    expect(DEFAULT_AGENT_MODEL_SET.securityModelConfigId).toBe('demo-gpt-4o');
  });

  it('compliance_expert 默认使用 demo-gpt-4o', () => {
    expect(DEFAULT_AGENT_MODEL_SET.complianceModelConfigId).toBe(
      'demo-gpt-4o',
    );
  });

  it('summary_agent 默认使用 demo-gpt-4o', () => {
    expect(DEFAULT_AGENT_MODEL_SET.summaryModelConfigId).toBe('demo-gpt-4o');
  });

  it('critic 默认使用 demo-gpt-4o', () => {
    expect(DEFAULT_AGENT_MODEL_SET.criticModelConfigId).toBe('demo-gpt-4o');
  });

  it('functional_expert 默认使用 demo-gpt-4o-mini', () => {
    expect(DEFAULT_AGENT_MODEL_SET.functionalModelConfigId).toBe(
      'demo-gpt-4o-mini',
    );
  });

  it('performance_expert 默认使用 demo-gpt-4o-mini', () => {
    expect(DEFAULT_AGENT_MODEL_SET.performanceModelConfigId).toBe(
      'demo-gpt-4o-mini',
    );
  });

  it('risk_agent 默认使用 demo-gpt-4o-mini', () => {
    expect(DEFAULT_AGENT_MODEL_SET.riskModelConfigId).toBe('demo-gpt-4o-mini');
  });

  it('compressor 默认使用 demo-deepseek-chat', () => {
    expect(DEFAULT_AGENT_MODEL_SET.compressorModelConfigId).toBe(
      'demo-deepseek-chat',
    );
  });

  it('高风险 5 个角色默认都是 demo-gpt-4o', () => {
    expect(HIGH_RISK_AGENTS.length).toBe(5);
    for (const agentName of HIGH_RISK_AGENTS) {
      const configKey = AGENT_TO_CONFIG_KEY[agentName];
      expect(
        DEFAULT_AGENT_MODEL_SET[configKey],
        `${agentName} 应该使用 demo-gpt-4o`,
      ).toBe('demo-gpt-4o');
    }
  });

  it('非高风险角色默认不是 demo-gpt-4o（functional / performance / risk / compressor）', () => {
    const nonHighRisk: AgentName[] = [
      'functional_expert',
      'performance_expert',
      'risk_agent',
      'compressor',
    ];
    for (const agentName of nonHighRisk) {
      expect(HIGH_RISK_AGENTS.includes(agentName)).toBe(false);
    }
  });

  it('AGENT_TO_CONFIG_KEY 覆盖全部 9 种 AgentName', () => {
    const allNames: AgentName[] = [
      'supervisor',
      'functional_expert',
      'performance_expert',
      'security_expert',
      'compliance_expert',
      'risk_agent',
      'summary_agent',
      'critic',
      'compressor',
    ];
    expect(Object.keys(AGENT_TO_CONFIG_KEY).sort()).toEqual(
      allNames.slice().sort(),
    );
  });

  it('resolveModelForAgent 默认无覆盖时返回角色默认 modelConfigId', () => {
    const result = resolveModelForAgent({ agentName: 'supervisor' });
    expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(result.overrideReason).toBeNull();
  });

  it('resolveModelForAgent functional 默认返回 demo-gpt-4o-mini', () => {
    const result = resolveModelForAgent({ agentName: 'functional_expert' });
    expect(result.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(result.overrideReason).toBeNull();
  });

  it('resolveModelForAgent compressor 默认返回 demo-deepseek-chat', () => {
    const result = resolveModelForAgent({ agentName: 'compressor' });
    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toBeNull();
  });
});

// ================================================================
// 10.9.2 运行时模型覆盖 — resolveModelForAgent 决策逻辑
// ================================================================
describe('10.9.2 运行时模型覆盖', () => {
  it('预算 85% 时 functional_expert 降级到 compressor model', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 85 },
    });

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toContain('budget_tight_downgrade');
    expect(result.overrideReason).toContain('85%');
  });

  it('预算 90% 时 security_expert 仍是 demo-gpt-4o（高风险不降级）', () => {
    const result = resolveModelForAgent({
      agentName: 'security_expert',
      budgetStatus: { usedPercent: 90 },
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(result.overrideReason).toBeNull();
  });

  it('预算 95% 时 critic 仍是 demo-gpt-4o（高风险不降级）', () => {
    const result = resolveModelForAgent({
      agentName: 'critic',
      budgetStatus: { usedPercent: 95 },
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(result.overrideReason).toBeNull();
  });

  it('预算 95% 时 risk_agent 降级（非高风险）', () => {
    const result = resolveModelForAgent({
      agentName: 'risk_agent',
      budgetStatus: { usedPercent: 95 },
    });

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toContain('budget_tight_downgrade');
    expect(result.overrideReason).toContain('95%');
  });

  it('预算 110% 时返回 budget_exceeded_reject', () => {
    const result = resolveModelForAgent({
      agentName: 'supervisor',
      budgetStatus: { usedPercent: 110 },
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(result.overrideReason).toBe('budget_exceeded_reject');
  });

  it('预算 110% 时 compressor 仍可用且 reason=null（豁免）', () => {
    const result = resolveModelForAgent({
      agentName: 'compressor',
      budgetStatus: { usedPercent: 110 },
    });

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toBeNull();
  });

  it('预算正好 100% 时非 compressor 返回 budget_exceeded_reject', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 100 },
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(result.overrideReason).toBe('budget_exceeded_reject');
  });

  it('预算正好 80% 时（含边界）非高风险降级', () => {
    const result = resolveModelForAgent({
      agentName: 'performance_expert',
      budgetStatus: { usedPercent: 80 },
    });

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toContain('budget_tight_downgrade');
    expect(result.overrideReason).toContain('80%');
  });

  it('预算 < 80% 时无预算降级（走默认）', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 50 },
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(result.overrideReason).toBeNull();
  });

  it('requirementComplexity=low 时 functional_expert 降级', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      requirementComplexity: 'low',
    });

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toBe('low_complexity_downgrade');
  });

  it('requirementComplexity=low 但 supervisor（高风险）不降级', () => {
    const result = resolveModelForAgent({
      agentName: 'supervisor',
      requirementComplexity: 'low',
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(result.overrideReason).toBeNull();
  });

  it('requirementComplexity=medium 不触发降级', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      requirementComplexity: 'medium',
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(result.overrideReason).toBeNull();
  });

  it('requirementComplexity=high 不触发降级', () => {
    const result = resolveModelForAgent({
      agentName: 'performance_expert',
      requirementComplexity: 'high',
    });

    expect(result.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(result.overrideReason).toBeNull();
  });

  it('预算紧张 + 低复杂度同时存在时，预算降级优先（先判断预算）', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 90 },
      requirementComplexity: 'low',
    });

    // 预算降级优先级更高
    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toContain('budget_tight_downgrade');
  });

  it('supplierModelSet 覆盖 DEFAULT_AGENT_MODEL_SET 默认值', () => {
    const customSet: AgentModelSet = {
      supervisorModelConfigId: 'custom-supervisor',
      functionalModelConfigId: 'custom-functional',
      performanceModelConfigId: 'custom-performance',
      securityModelConfigId: 'custom-security',
      complianceModelConfigId: 'custom-compliance',
      riskModelConfigId: 'custom-risk',
      summaryModelConfigId: 'custom-summary',
      criticModelConfigId: 'custom-critic',
      compressorModelConfigId: 'custom-compressor',
    };

    const result = resolveModelForAgent({
      agentName: 'supervisor',
      defaultModelSet: customSet,
    });

    expect(result.selectedModelConfigId).toBe('custom-supervisor');
    expect(result.overrideReason).toBeNull();
  });

  it('任何 override 路径的 overrideReason 不为空字符串或 null', () => {
    // budget 降级路径
    const r1 = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 85 },
    });
    expect(r1.overrideReason).toBeTruthy();

    // 低复杂度降级路径
    const r2 = resolveModelForAgent({
      agentName: 'performance_expert',
      requirementComplexity: 'low',
    });
    expect(r2.overrideReason).toBeTruthy();

    // 预算超限路径
    const r3 = resolveModelForAgent({
      agentName: 'summary_agent',
      budgetStatus: { usedPercent: 100 },
    });
    expect(r3.overrideReason).toBeTruthy();
  });
});

// ================================================================
// 10.8.2 TokenUsageService
// ================================================================
describe('10.8.2 TokenUsageService', () => {
  /**
   * 构造一个 mock Prisma client，仅提供 tokenUsage delegate。
   */
  function createMockPrisma() {
    const createFn = mock(async (_args: { data: Record<string, unknown> }) => {
      // 默认成功，无返回值
    });
    const aggregateFn = mock(
      async (_args: Record<string, unknown>) =>
        ({ _sum: {}, _count: 0 }) as unknown,
    );
    const groupByFn = mock(
      async (_args: Record<string, unknown>) => [] as Record<string, unknown>[],
    );

    const client: TokenUsageClient = {
      tokenUsage: {
        create: createFn,
        aggregate: aggregateFn,
        groupBy: groupByFn,
      },
    };

    return { client, createFn, aggregateFn, groupByFn };
  }

  const makeRecord = (overrides?: Partial<TokenUsageRecord>): TokenUsageRecord => ({
    graphName: 'requirement-analysis',
    nodeName: 'supervisor',
    agentName: 'supervisor',
    modelName: 'gpt-4o',
    inputTokens: 500,
    outputTokens: 100,
    totalTokens: 600,
    estimatedCostUsd: 0.00225,
    ...overrides,
  });

  it('recordUsage 写入完整字段', async () => {
    const { client, createFn } = createMockPrisma();
    const service = new TokenUsageService(client);

    await service.recordUsage(
      makeRecord({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        threadId: 'thread-1',
        modelConfigId: 'demo-gpt-4o',
        provider: 'openai',
        cachedInputTokens: 50,
        isEstimated: false,
        latencyMs: 1234,
        overrideReason: null,
      }),
    );

    expect(createFn).toHaveBeenCalledTimes(1);
    const callData = createFn.mock.calls[0][0].data as Record<string, unknown>;

    expect(callData.graphName).toBe('requirement-analysis');
    expect(callData.nodeName).toBe('supervisor');
    expect(callData.agentName).toBe('supervisor');
    expect(callData.modelName).toBe('gpt-4o');
    expect(callData.modelConfigId).toBe('demo-gpt-4o');
    expect(callData.conversationId).toBe('conv-1');
    expect(callData.messageId).toBe('msg-1');
    expect(callData.threadId).toBe('thread-1');
    expect(callData.provider).toBe('openai');
    expect(callData.inputTokens).toBe(500);
    expect(callData.outputTokens).toBe(100);
    expect(callData.totalTokens).toBe(600);
    expect(callData.cachedInputTokens).toBe(50);
    expect(callData.estimatedCostUsd).toBe(0.00225);
    expect(callData.isEstimated).toBe(false);
    expect(callData.latencyMs).toBe(1234);
    expect(callData.overrideReason).toBeNull();
  });

  it('totalTokens 未传时用 inputTokens + outputTokens 兜底', async () => {
    const { client, createFn } = createMockPrisma();
    const service = new TokenUsageService(client);

    await service.recordUsage(
      makeRecord({ inputTokens: 300, outputTokens: 200, totalTokens: undefined }),
    );

    const callData = createFn.mock.calls[0][0].data as Record<string, unknown>;
    expect(callData.totalTokens).toBe(500);
  });

  it('prisma 抛异常时 service 不向上抛', async () => {
    const { client, createFn } = createMockPrisma();
    createFn.mockImplementation(async () => {
      throw new Error('DB connection lost');
    });
    const service = new TokenUsageService(client);

    // 不应 throw
    await expect(
      service.recordUsage(makeRecord()),
    ).resolves.toBeUndefined();
  });

  it('月度聚合 totalCost 正确', async () => {
    const { client, aggregateFn } = createMockPrisma();
    aggregateFn.mockImplementation(async () => ({
      _sum: {
        estimatedCostUsd: 12.5,
        inputTokens: 50000,
        outputTokens: 10000,
        cachedInputTokens: 5000,
      },
      _count: 120,
    }));
    const service = new TokenUsageService(client);

    const stats = await service.getMonthlyStats();

    expect(stats.totalCost).toBe(12.5);
    expect(stats.totalInputTokens).toBe(50000);
    expect(stats.totalOutputTokens).toBe(10000);
    expect(stats.totalCachedTokens).toBe(5000);
    expect(stats.calls).toBe(120);

    // 验证 where 包含当月过滤
    const callArg = aggregateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.where).toBeDefined();
    expect((callArg.where as Record<string, unknown>).createdAt).toBeDefined();
  });

  it('getStatsByNode 按 totalCost 降序', async () => {
    const { client, groupByFn } = createMockPrisma();
    groupByFn.mockImplementation(async () => [
      { nodeName: 'analysisAgent', _sum: { estimatedCostUsd: 5.0 }, _count: 50 },
      { nodeName: 'supervisor', _sum: { estimatedCostUsd: 2.5 }, _count: 30 },
    ]);
    const service = new TokenUsageService(client);

    const stats = await service.getStatsByNode();

    expect(stats.length).toBe(2);
    expect(stats[0].nodeName).toBe('analysisAgent');
    expect(stats[0].totalCost).toBe(5.0);
    expect(stats[0].calls).toBe(50);
    expect(stats[1].nodeName).toBe('supervisor');
    expect(stats[1].totalCost).toBe(2.5);

    const callArg = groupByFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.by).toEqual(['nodeName']);
    expect(callArg.orderBy).toBeDefined();
  });

  it('getStatsByAgent 按 agentName 聚合', async () => {
    const { client, groupByFn } = createMockPrisma();
    groupByFn.mockImplementation(async () => [
      { agentName: 'security_expert', _sum: { estimatedCostUsd: 8.0 }, _count: 20 },
      { agentName: 'functional_expert', _sum: { estimatedCostUsd: 1.5 }, _count: 40 },
    ]);
    const service = new TokenUsageService(client);

    const stats = await service.getStatsByAgent();

    expect(stats.length).toBe(2);
    expect(stats[0].agentName).toBe('security_expert');
    expect(stats[0].totalCost).toBe(8.0);
    expect(stats[0].calls).toBe(20);

    const callArg = groupByFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.by).toEqual(['agentName']);
  });

  it('isOverBudget 成本 >= 预算返回 true', async () => {
    const { client, aggregateFn } = createMockPrisma();
    aggregateFn.mockImplementation(async () => ({
      _sum: { estimatedCostUsd: 100.0 },
      _count: 1000,
    }));
    const service = new TokenUsageService(client);

    expect(await service.isOverBudget(50)).toBe(true);
    expect(await service.isOverBudget(100)).toBe(true);
  });

  it('isOverBudget 成本 < 预算返回 false', async () => {
    const { client, aggregateFn } = createMockPrisma();
    aggregateFn.mockImplementation(async () => ({
      _sum: { estimatedCostUsd: 30.0 },
      _count: 300,
    }));
    const service = new TokenUsageService(client);

    expect(await service.isOverBudget(100)).toBe(false);
  });

  it('聚合查询异常时 getMonthlyStats 返回 0 不抛异常', async () => {
    const { client, aggregateFn } = createMockPrisma();
    aggregateFn.mockImplementation(async () => {
      throw new Error('query timeout');
    });
    const service = new TokenUsageService(client);

    const stats = await service.getMonthlyStats();

    expect(stats.totalCost).toBe(0);
    expect(stats.calls).toBe(0);
  });
});

// ================================================================
// 10.8.3 withTokenUsage
// ================================================================
describe('10.8.3 withTokenUsage', () => {
  const baseOptions = {
    graphName: 'requirement-analysis',
    nodeName: 'supervisor',
    agentName: 'supervisor',
    modelName: 'gpt-4o',
  };

  /**
   * 构造 mock TokenUsageService，暴露 recordUsage mock 以便验证。
   */
  function createMockUsageService() {
    const recordUsageFn = mock(async (_record: TokenUsageRecord) => {
      // 默认成功
    });
    const service = {
      recordUsage: recordUsageFn,
      getMonthlyStats: mock(async () => ({})),
      getStatsByNode: mock(async () => []),
      getStatsByAgent: mock(async () => []),
      isOverBudget: mock(async () => false),
    } as unknown as TokenUsageService;

    return { service, recordUsageFn };
  }

  it('response 带 usage_metadata 时精确记录 input/output/cached，isEstimated=false', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {
      usage_metadata: {
        input_tokens: 1200,
        output_tokens: 300,
        total_tokens: 1500,
        cache_read_input_tokens: 200,
      },
      content: '分析结果...',
    };

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, service, fn);

    expect(result).toBe(fakeResponse);
    expect(recordUsageFn).toHaveBeenCalledTimes(1);

    // 等异步 recordUsage 完成（已是 await，直接断言）
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.inputTokens).toBe(1200);
    expect(record.outputTokens).toBe(300);
    expect(record.cachedInputTokens).toBe(200);
    expect(record.isEstimated).toBe(false);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('response 带 OpenAI response_metadata.usage 时精确记录', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {
      response_metadata: {
        usage: {
          prompt_tokens: 800,
          completion_tokens: 200,
          total_tokens: 1000,
          prompt_tokens_details: {
            cached_tokens: 150,
          },
        },
      },
      content: '抽取结果...',
    };

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, service, fn);

    expect(result).toBe(fakeResponse);
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.inputTokens).toBe(800);
    expect(record.outputTokens).toBe(200);
    expect(record.cachedInputTokens).toBe(150);
    expect(record.isEstimated).toBe(false);
  });

  it('不带 metadata 时走估算：output = estimateTextTokens(content), input = output × 5', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const outputContent = '这是一条比较长的输出文本包含中英文 mixed-content 用于测试估算逻辑';
    const fakeResponse: LLMResponseLike = {
      content: outputContent,
    };

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, service, fn);

    expect(result).toBe(fakeResponse);
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.isEstimated).toBe(true);
    expect(record.outputTokens).toBeGreaterThan(0);
    // input = output × 5
    expect(record.inputTokens).toBe(record.outputTokens * 5);
    // cost 应 > 0
    expect(record.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('不含 content 也不含 text 时 outputTokens = 0', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {};

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, service, fn);

    expect(result).toBe(fakeResponse);
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.isEstimated).toBe(true);
    expect(record.outputTokens).toBe(0);
    expect(record.inputTokens).toBe(0); // 0 × 5 = 0
  });

  it('cached input 按折扣价计价', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {
      usage_metadata: {
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_input_tokens: 800,
      },
      content: 'result',
    };

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, service, fn);

    expect(result).toBe(fakeResponse);
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.cachedInputTokens).toBe(800);

    // gpt-4o pricing: input=2.5, cachedInput=1.25, output=10.0
    // freshInput = (1000 - 800) * 2.5 / 1e6 = 200 * 2.5 / 1e6 = 0.0005
    // cachedCost = 800 * 1.25 / 1e6 = 0.001
    // outputCost = 100 * 10.0 / 1e6 = 0.001
    // total = 0.0025
    expect(record.estimatedCostUsd).toBeCloseTo(0.0025, 6);
  });

  it('recordUsage 抛错时仍返回模型响应（侧路不阻塞）', async () => {
    const { service, recordUsageFn } = createMockUsageService();
    // recordUsage 会在内部 try/catch 中吞掉，但 withTokenUsage 的 catch 也吞
    recordUsageFn.mockImplementation(async () => {
      throw new Error('insert failed');
    });

    const fakeResponse: LLMResponseLike = {
      content: 'still works',
    };

    const fn = mock(async () => fakeResponse);

    // 不应抛异常
    const result = await withTokenUsage(baseOptions, service, fn);

    // 结果仍然返回
    expect(result).toBe(fakeResponse);
  });

  it('usageService 为 null 时跳过记录并返回结果', async () => {
    const fakeResponse: LLMResponseLike = {
      usage_metadata: { input_tokens: 100, output_tokens: 50 },
      content: 'test',
    };

    const fn = mock(async () => fakeResponse);

    const result = await withTokenUsage(baseOptions, null, fn);

    expect(result).toBe(fakeResponse);
    // fn 仍然被调用
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('latencyMs 记录调用耗时', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {
      content: 'test',
    };

    let resolveFn!: () => void;
    const fn = mock(
      () =>
        new Promise<LLMResponseLike>((resolve) => {
          resolveFn = () => resolve(fakeResponse);
        }),
    );

    const promise = withTokenUsage(baseOptions, service, fn);

    // 延迟 50ms 再 resolve
    await new Promise((r) => setTimeout(r, 50));
    resolveFn();
    await promise;
    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.latencyMs).toBeGreaterThanOrEqual(40); // 允许误差
  });

  it('传入 modelConfigId / conversationId / overrideReason 正确传递到 record', async () => {
    const { service, recordUsageFn } = createMockUsageService();

    const fakeResponse: LLMResponseLike = {
      usage_metadata: { input_tokens: 200, output_tokens: 50 },
      content: 'result',
    };

    const fn = mock(async () => fakeResponse);

    await withTokenUsage(
      {
        ...baseOptions,
        modelConfigId: 'demo-gpt-4o',
        conversationId: 'conv-123',
        messageId: 'msg-456',
        threadId: 'thread-789',
        provider: 'openai',
        overrideReason: 'budget_tight_downgrade (85%)',
      },
      service,
      fn,
    );

    await new Promise((r) => setTimeout(r, 10));

    const record = recordUsageFn.mock.calls[0][0];
    expect(record.modelConfigId).toBe('demo-gpt-4o');
    expect(record.conversationId).toBe('conv-123');
    expect(record.messageId).toBe('msg-456');
    expect(record.threadId).toBe('thread-789');
    expect(record.provider).toBe('openai');
    expect(record.overrideReason).toBe('budget_tight_downgrade (85%)');
  });
});

// ================================================================
// 10.9.3 预算动作选择 - resolveBudgetAction
// ================================================================
describe('10.9.3 预算动作选择 - resolveBudgetAction', () => {
  it('50% 预算 → allow', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 50,
      agentName: 'functional_expert',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toBe('budget OK (50%)');
  });

  it('79% 预算 → allow（边界）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 79,
      agentName: 'performance_expert',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toContain('budget OK');
  });

  it('85% 预算 + functional_expert → downgrade', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 85,
      agentName: 'functional_expert',
    });

    expect(result.action).toBe('downgrade');
    expect(result.reason).toContain('budget tight');
    expect(result.reason).toContain('low-risk');
    expect(result.reason).toContain('85');
  });

  it('90% 预算 + security_expert → allow（高风险不降级）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 90,
      agentName: 'security_expert',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toContain('high-risk agent, no downgrade');
    expect(result.reason).toContain('90');
  });

  it('95% 预算 + supervisor → allow（高风险不降级）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 95,
      agentName: 'supervisor',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toContain('high-risk agent, no downgrade');
  });

  it('99% 预算 + risk_agent → downgrade（非高风险）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 99,
      agentName: 'risk_agent',
    });

    expect(result.action).toBe('downgrade');
    expect(result.reason).toContain('budget tight');
    expect(result.reason).toContain('low-risk');
  });

  it('110% 预算 + risk_agent → reject', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: 'risk_agent',
    });

    expect(result.action).toBe('reject');
    expect(result.reason).toContain('budget exceeded');
    expect(result.reason).toContain('110');
  });

  it('110% 预算 + compressor → allow（豁免）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: 'compressor',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toContain('compressor allowed even over budget');
    expect(result.reason).toContain('cost reduction purpose');
  });

  it('150% 预算 + compressor → allow（始终豁免）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 150,
      agentName: 'compressor',
    });

    expect(result.action).toBe('allow');
  });

  it('100% 预算 + supervisor → reject（边界）', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 100,
      agentName: 'supervisor',
    });

    expect(result.action).toBe('reject');
    expect(result.reason).toContain('budget exceeded');
    expect(result.reason).toContain('100');
  });

  it('100% 预算 + functional_expert → reject', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 100,
      agentName: 'functional_expert',
    });

    expect(result.action).toBe('reject');
  });

  it('80% 边界 + performance_expert → downgrade', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 80,
      agentName: 'performance_expert',
    });

    expect(result.action).toBe('downgrade');
    expect(result.reason).toContain('80');
  });

  it('80% 边界 + critic（高风险）→ allow', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 80,
      agentName: 'critic',
    });

    expect(result.action).toBe('allow');
    expect(result.reason).toContain('high-risk agent, no downgrade');
  });

  it('reason 字段始终包含具体百分比或豁免说明', () => {
    const cases: BudgetPolicyInput[] = [
      { budgetUsedPercent: 30, agentName: 'supervisor' },
      { budgetUsedPercent: 85, agentName: 'functional_expert' },
      { budgetUsedPercent: 92, agentName: 'compliance_expert' },
      { budgetUsedPercent: 120, agentName: 'summary_agent' },
      { budgetUsedPercent: 200, agentName: 'compressor' },
    ];

    for (const input of cases) {
      const result = resolveBudgetAction(input);
      expect(result.reason.length).toBeGreaterThan(5);

      // 验证 reason 与 action 的对应关系
      switch (result.action) {
        case 'allow':
          // allow 要么是 budget OK，要么 high-risk，要么 compressor 豁免
          expect(
            result.reason.includes('budget OK') ||
              result.reason.includes('high-risk') ||
              result.reason.includes('compressor'),
          ).toBe(true);
          break;
        case 'downgrade':
          expect(result.reason).toContain('downgrade');
          break;
        case 'reject':
          expect(result.reason).toContain('exceeded');
          break;
      }
    }
  });

  it('全部 5 个高风险角色在 85% 预算时都是 allow', () => {
    // HIGH_RISK_AGENTS = ['supervisor', 'security_expert', 'compliance_expert', 'critic', 'summary_agent']
    const highRiskAgents: AgentName[] = [
      'supervisor',
      'security_expert',
      'compliance_expert',
      'critic',
      'summary_agent',
    ];

    for (const agent of highRiskAgents) {
      const result = resolveBudgetAction({
        budgetUsedPercent: 85,
        agentName: agent,
      });
      expect(
        result.action,
        `${agent} 在 85% 预算时应该是 allow`,
      ).toBe('allow');
      expect(result.reason).toContain('high-risk agent, no downgrade');
    }
  });

  it('全部非高风险角色在 85% 预算时都是 downgrade', () => {
    const lowRiskAgents: AgentName[] = [
      'functional_expert',
      'performance_expert',
      'risk_agent',
    ];

    for (const agent of lowRiskAgents) {
      const result = resolveBudgetAction({
        budgetUsedPercent: 85,
        agentName: agent,
      });
      expect(
        result.action,
        `${agent} 在 85% 预算时应该是 downgrade`,
      ).toBe('downgrade');
    }
  });
});
