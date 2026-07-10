/**
 * test-tool-calls-format.ts — 查看 LLM 调用工具时返回的 tool_calls 数据格式
 *
 * 运行方式：bun run services/chat/src/llm/test-tool-calls-format.ts
 * 前置条件：config/langchain.yaml + 环境变量（DEEPSEEK_API_KEY）已就绪
 */

import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from './model.factory';
import { basicTools } from './tools/basic.tools';

// ===============================================================
// 辅助函数：深度打印对象结构
// ===============================================================

function printSeparator(title: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

function printJson(label: string, obj: unknown) {
  console.log(`\n📌 ${label}:`);
  console.log(JSON.stringify(obj, null, 2));
}

function printTypeInfo(label: string, value: unknown) {
  const type = typeof value;
  const constructorName = value?.constructor?.name ?? 'null/undefined';
  const isArray = Array.isArray(value);
  console.log(`\n🔍 ${label}:`);
  console.log(`   typeof: ${type}`);
  console.log(`   constructor: ${constructorName}`);
  console.log(`   isArray: ${isArray}`);
  if (isArray) {
    console.log(`   length: ${(value as unknown[]).length}`);
  }
  if (value !== null && value !== undefined) {
    console.log(`   keys: [${Object.keys(value as object).join(', ')}]`);
  }
}

// ===============================================================
// 测试 1: toolBind — 单次调用，查看 tool_calls 原始结构
// ===============================================================
async function testToolBind() {
  printSeparator('测试 1: toolBind — 单次模型调用（绑定工具）');

  const model = createChatModel();
  const modelWithTools = model.bindTools([...basicTools]);

  // 这个 prompt 设计为很可能触发工具调用
  const input = '用户注册时必须绑定手机号，密码至少8位';
  const messages = [
    new SystemMessage('你是一名需求结构化抽取助手。可按需调用工具检查约束有效性和查询实体定义。'),
    new HumanMessage(`请分析以下需求，并在必要时调用工具：${input}`),
  ];

  console.log('\n📤 发送消息:');
  console.log(`   SystemMessage: 你是一名需求结构化抽取助手...`);
  console.log(`   HumanMessage: 请分析以下需求，并在必要时调用工具：${input}`);

  const response = await modelWithTools.invoke(messages);

  // ===============================================================
  // 详细打印 response 对象
  // ===============================================================
  printSeparator('Response 对象完整结构');

  console.log('\n🔬 response 实例信息:');
  console.log(`   constructor.name: ${response.constructor.name}`);
  console.log(`   response 类型: ${typeof response}`);
  console.log(`   instanceof AIMessage: ${response instanceof AIMessage}`);

  printTypeInfo('response', response);

  console.log('\n📋 response 顶层属性:');
  console.log(`   response.content: ${JSON.stringify(response.content)}`);
  console.log(`   response.content typeof: ${typeof response.content}`);
  console.log(`   response.content.toString(): ${response.content.toString()}`);
  console.log(`   response.id: ${response.id}`);
  console.log(`   response.name: ${response.name}`);
  console.log(`   response.type: ${response.type}`);
  console.log(`   response.additional_kwargs: ${JSON.stringify(response.additional_kwargs)}`);
  console.log(`   response.response_metadata: ${JSON.stringify(response.response_metadata)}`);

  // ===============================================================
  // 核心：tool_calls 详细分析
  // ===============================================================
  printSeparator('🔑 tool_calls 详细分析');

  const toolCalls = response.tool_calls;

  printTypeInfo('response.tool_calls', toolCalls);

  if (toolCalls && toolCalls.length > 0) {
    console.log(`\n✅ 模型调用了 ${toolCalls.length} 个工具:\n`);

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      console.log(`  ┌─ tool_calls[${i}] ─────────────────────────────────`);
      console.log(`  │ 类型: ${tc.constructor.name}`);
      console.log(`  │ typeof: ${typeof tc}`);
      console.log(`  │ keys: [${Object.keys(tc).join(', ')}]`);
      console.log(`  │`);
      console.log(`  │ name:    ${JSON.stringify(tc.name)}`);
      console.log(`  │ args:    ${JSON.stringify(tc.args)}`);
      console.log(`  │ id:      ${JSON.stringify(tc.id)}`);
      console.log(`  │ type:    ${JSON.stringify(tc.type)}`);
      // 打印所有其他可能存在的字段
      for (const key of Object.keys(tc)) {
        if (!['name', 'args', 'id', 'type'].includes(key)) {
          console.log(`  │ ${key}: ${JSON.stringify((tc as Record<string, unknown>)[key])}`);
        }
      }
      console.log(`  └──────────────────────────────────────────────`);
    }
  } else {
    console.log('\n⚠️  模型没有调用工具（tool_calls 为空）');
    console.log('   这意味着模型认为不需要工具就能回答');
    console.log(`   response.content: ${response.content.toString()}`);
  }

  // ===============================================================
  // 额外：查看 LangChain 内部的 tool_calls 结构化对象
  // ===============================================================
  printSeparator('LangChain 内部 tool_call_chunks / additional_kwargs');

  // deepseek 等不同 provider 可能在 additional_kwargs 里也有 tool_calls
  if (response.additional_kwargs && Object.keys(response.additional_kwargs).length > 0) {
    console.log('\n📦 additional_kwargs 内容:');
    console.log(JSON.stringify(response.additional_kwargs, null, 2));
  } else {
    console.log('\n📦 additional_kwargs 为空（DeepSeek 的 tool_calls 在顶层）');
  }

  console.log('\n📦 response_metadata 内容:');
  console.log(JSON.stringify(response.response_metadata, null, 2));

  return { response, toolCalls };
}

// ===============================================================
// 测试 2: toolLoop — 完整工具循环，查看每一步
// ===============================================================
async function testToolLoop() {
  printSeparator('测试 2: toolLoop — 完整工具调用循环');

  const model = createChatModel();
  const modelWithTools = model.bindTools([...basicTools]);

  const input = '用户注册时必须绑定手机号，密码至少8位，并且要记录日志';
  const messages = [
    new SystemMessage('你是一名需求结构化抽取助手。可按需调用工具检查约束有效性和查询实体定义。'),
    new HumanMessage(`请基于以下需求做结构化分析；如有必要，先调用工具再输出最终结论：${input}`),
  ];

  let round = 0;
  const MAX_ROUNDS = 5;

  while (round < MAX_ROUNDS) {
    round++;
    printSeparator(`Tool Loop Round ${round}`);

    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    console.log(`\n📥 第 ${round} 轮模型响应:`);
    console.log(`   response.type: ${response.type}`);
    console.log(`   response.content (原始): ${JSON.stringify(response.content)}`);
    console.log(`   response.content.toString(): "${response.content.toString()}"`);

    const toolCalls = response.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      console.log('\n🛑 模型不再调用工具，对话结束');
      console.log(`\n📝 最终回复:\n${response.content.toString()}`);
      break;
    }

    console.log(`\n🔧 模型调用了 ${toolCalls.length} 个工具:`);

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      console.log(`\n  ┌─ tool_call[${i}] ─────────────────────────────`);
      console.log(`  │ 完整对象:`);
      console.log(`  │ ${JSON.stringify(tc, null, 2).replace(/\n/g, '\n  │ ')}`);
      console.log(`  │`);
      console.log(`  │ 字段拆解:`);
      console.log(`  │   tc.name = ${tc.name}`);
      console.log(`  │   tc.args = ${JSON.stringify(tc.args)}`);
      console.log(`  │   tc.id   = ${tc.id}`);
      console.log(`  │   tc.type = ${tc.type}`);
      console.log(`  └──────────────────────────────────────────────`);

      // 执行工具
      const selectedTool = basicTools.find((tool) => tool.name === tc.name);
      if (selectedTool) {
        const toolExecutor = selectedTool as { invoke: (args: unknown) => Promise<unknown> };
        const result = await toolExecutor.invoke(tc.args);
        console.log(`\n  ⚙️  工具执行结果:`);
        console.log(`  ${JSON.stringify(result, null, 2).replace(/\n/g, '\n  ')}`);

        // 构造 ToolMessage 返回给模型
        const toolMessage = new ToolMessage({
          tool_call_id: tc.id ?? tc.name,
          content: JSON.stringify(result),
        });
        console.log(`\n  📤 构造 ToolMessage:`);
        console.log(`     tool_call_id: ${tc.id ?? tc.name}`);
        console.log(`     content: ${JSON.stringify(result)}`);
        console.log(`     ToolMessage.type: ${toolMessage.type}`);

        messages.push(toolMessage);
      } else {
        console.log(`  ⚠️  未找到工具 "${tc.name}"`);
      }
    }
  }

  if (round >= MAX_ROUNDS) {
    console.log('\n⚠️  达到最大循环次数，强制终止');
  }
}

// ===============================================================
// 测试 3: 对比 — 不绑定工具时的响应格式
// ===============================================================
async function testNoTools() {
  printSeparator('测试 3: 对比 — 不绑定工具时的响应格式');

  const model = createChatModel();
  const input = '用户注册时必须绑定手机号，密码至少8位';

  const messages = [
    new SystemMessage('你是一名需求结构化抽取助手'),
    new HumanMessage(`请分析以下需求：${input}`),
  ];

  const response = await model.invoke(messages);

  console.log('\n📥 无工具绑定的响应:');
  console.log(`   type: ${response.type}`);
  console.log(`   content: ${response.content.toString()}`);
  console.log(`   tool_calls: ${JSON.stringify(response.tool_calls)}`);
  console.log(`   additional_kwargs: ${JSON.stringify(response.additional_kwargs)}`);

  console.log('\n💡 对比结论:');
  console.log('   不绑定工具时，tool_calls 通常为 undefined 或空数组 []');
  console.log('   绑定工具后，模型可能返回 tool_calls 数组，每个元素包含 name、args、id、type');
}

// ===============================================================
// 测试 4: 直接打印 AIMessage 的 JSON 序列化
// ===============================================================
async function testJsonSerialization() {
  printSeparator('测试 4: AIMessage JSON 序列化格式');

  const model = createChatModel();
  const modelWithTools = model.bindTools([...basicTools]);

  const input = '用户注册时必须绑定手机号，密码至少8位';
  const messages = [
    new SystemMessage('你是一名需求结构化抽取助手。工具可供调用：check_constraint_validity, lookup_entity_definition'),
    new HumanMessage(`请使用工具检查以下需求中的约束和实体："${input}"`),
  ];

  const response = await modelWithTools.invoke(messages);

  // 尝试多种序列化方式
  console.log('\n📋 1. JSON.stringify(response):');
  try {
    console.log(JSON.stringify(response, null, 2));
  } catch (e) {
    console.log(`   Error: ${e}`);
  }

  console.log('\n📋 2. response.toJSON():');
  try {
    console.log(JSON.stringify(response.toJSON(), null, 2));
  } catch (e) {
    console.log(`   Error: ${e}`);
  }

  console.log('\n📋 3. LangChain 内部的 _getPromptRepresentation / contentBlocks:');
  // 查看是否有 contentBlocks (LangChain v0.3+)
  const respAny = response as Record<string, unknown>;
  if ('content_blocks' in respAny) {
    console.log(JSON.stringify(respAny['content_blocks'], null, 2));
  } else {
    console.log('   没有 content_blocks 属性');
  }

  // 尝试用 LangChain 的序列化
  console.log('\n📋 4. response.lc_kwargs:');
  if ('lc_kwargs' in respAny) {
    console.log(JSON.stringify(respAny['lc_kwargs'], null, 2));
  } else {
    console.log('   没有 lc_kwargs 属性');
  }
}

// ===============================================================
// 主函数
// ===============================================================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               LLM Tool Calls 数据格式探测试                                  ║');
  console.log('║               项目: dream-llm / provider: deepseek                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  console.log('\n📌 可用工具:');
  for (const tool of basicTools) {
    console.log(`   - ${tool.name}: ${tool.description}`);
  }

  try {
    await testToolBind();
    console.log('\n\n');
    await testToolLoop();
    console.log('\n\n');
    await testNoTools();
    console.log('\n\n');
    await testJsonSerialization();

    printSeparator('✅ 所有测试完成');
    console.log('\n总结:');
    console.log('  tool_calls 是一个数组，每个元素是对象:');
    console.log('  {');
    console.log('    name: string,    // 工具名称，如 "check_constraint_validity"');
    console.log('    args: object,    // 工具参数，如 { constraint: "密码至少8位" }');
    console.log('    id: string,      // 唯一标识，用于关联 ToolMessage');
    console.log('    type: "tool_call" // 固定值');
    console.log('  }');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
  }
}

main();
