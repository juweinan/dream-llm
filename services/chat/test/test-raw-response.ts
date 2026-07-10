/**
 * test-raw-response.ts — 查看大模型调用工具时真正的原始 HTTP 响应 vs LangChain 加工后的格式
 *
 * 运行方式：
 *   bun run services/chat/src/llm/test-raw-response.ts
 *
 * 前置条件：config/langchain.yaml + 环境变量（DEEPSEEK_API_KEY）已就绪
 * 开启原始日志：export LANGCHAIN_VERBOSE=true
 */

// ==========================================================
// 开启 LangChain 底层 HTTP 日志，可以直接看到 API 请求/响应
// ==========================================================
process.env.LANGCHAIN_VERBOSE = 'true';
process.env.LANGCHAIN_DEBUG = 'true';

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from './model.factory';
import { basicTools } from './tools/basic.tools';

async function main() {
  console.log('═'.repeat(80));
  console.log('  查看大模型 tool_calls 原始 HTTP 响应格式');
  console.log('═'.repeat(80));

  const model = createChatModel();
  const modelWithTools = model.bindTools([...basicTools]);

  const input = '用户注册时必须绑定手机号，密码至少8位';
  const messages = [
    new SystemMessage('你是一名需求结构化抽取助手。工具可供调用：check_constraint_validity, lookup_entity_definition'),
    new HumanMessage(`请使用工具检查以下需求中的约束和实体："${input}"`),
  ];

  console.log('\n📤 【发送给 DeepSeek API 的 messages】');
  for (const msg of messages) {
    console.log(`   [${msg.getType()}] ${msg.content.toString().slice(0, 100)}...`);
  }
  console.log(`   (还附带 tools 定义，见上方 LANGCHAIN_VERBOSE 输出)`);

  const response = await modelWithTools.invoke(messages);

  // ==========================================================
  // 这是 LangChain 帮我们解析好的格式（推荐直接使用）
  // ==========================================================
  console.log('\n' + '═'.repeat(80));
  console.log('  📍 第一层：response.tool_calls — LangChain 解析好的格式（推荐使用）');
  console.log('═'.repeat(80));
  console.log(`  类型: Array<{name, args, id, type}>`);
  console.log(`  其中 args 已经是解析好的 JS 对象，不是 JSON 字符串\n`);

  if (response.tool_calls?.length) {
    response.tool_calls.forEach((tc, i) => {
      console.log(`  tool_calls[${i}]:`);
      console.log(`    name: "${tc.name}"`);
      console.log(`    args: ${JSON.stringify(tc.args)}`);
      console.log(`    id:   "${tc.id}"`);
      console.log(`    type: "${tc.type}"`);
      console.log();
    });
  }

  // ==========================================================
  // 这是 DeepSeek API 原始返回（存在 additional_kwargs 里）
  // ==========================================================
  console.log('═'.repeat(80));
  console.log('  📍 第二层：response.additional_kwargs.tool_calls — Provider 原始格式');
  console.log('═'.repeat(80));
  console.log('  这就是 DeepSeek API 返回的原始 JSON（Chat Completion API 格式）');
  console.log('  注意：function.arguments 是 JSON 字符串，不是对象\n');

  if (response.additional_kwargs?.tool_calls) {
    const rawCalls = response.additional_kwargs.tool_calls as Array<Record<string, unknown>>;
    rawCalls.forEach((tc: Record<string, unknown>, i: number) => {
      console.log(`  raw_tool_calls[${i}]:`);
      console.log(`    index: ${tc.index}`);
      console.log(`    id:    ${tc.id}`);
      console.log(`    type:  ${tc.type}`);
      const fn = tc.function as Record<string, unknown>;
      console.log(`    function.name:      "${fn.name}"`);
      console.log(`    function.arguments:  ${fn.arguments}  ← 这是 JSON 字符串！`);
      console.log(`    (JSON.parse 后: ${JSON.stringify(JSON.parse(fn.arguments as string))})`);
      console.log();
    });
  }

  // ==========================================================
  // 完整的 response_metadata（token 用量等）
  // ==========================================================
  console.log('═'.repeat(80));
  console.log('  📍 第三层：response.response_metadata — 响应元数据');
  console.log('═'.repeat(80));
  console.log(JSON.stringify(response.response_metadata, null, 2));

  console.log('\n' + '═'.repeat(80));
  console.log('  📍 第四层：response.content — 模型同时输出的文本');
  console.log('═'.repeat(80));
  console.log('  模型在调用工具时，content 通常是一段"意图说明"文字：');
  console.log('  "' + response.content.toString().slice(0, 200) + '..."');

  // ==========================================================
  // 关键对比总结
  // ==========================================================
  console.log('\n' + '═'.repeat(80));
  console.log('  📊 总结：三种数据格式对比');
  console.log('═'.repeat(80));
  console.log(`
  ┌────────────────────┬──────────────────────────────┬─────────────────────────────┐
  │ 来源                │ 格式                          │ args/arguments 类型         │
  ├────────────────────┼──────────────────────────────┼─────────────────────────────┤
  │ response.tool_calls │ {name, args, id, type}        │ args 是 JS 对象 (已 parse)  │
  │ additional_kwargs   │ {index,id,type,function{...}} │ function.arguments 是字符串  │
  │ DeepSeek HTTP 原始   │ Chat Completions API 格式     │ arguments 是 JSON 字符串    │
  └────────────────────┴──────────────────────────────┴─────────────────────────────┘

  实际代码中直接用 response.tool_calls 即可，LangChain 已经帮你处理好了。
  构造 ToolMessage 用 response.tool_calls[i].id 和 response.tool_calls[i].args。
  `);

  // ==========================================================
  // 模拟一轮完整工具执行
  // ==========================================================
  console.log('═'.repeat(80));
  console.log('  📍 第五层：模拟一轮工具执行（ToolMessage 格式）');
  console.log('═'.repeat(80));

  if (response.tool_calls?.length) {
    const tc = response.tool_calls[0];
    const tool = basicTools.find(t => t.name === tc.name)!;
    const result = await (tool as { invoke: (a: unknown) => Promise<unknown> }).invoke(tc.args);

    const toolMessage = new ToolMessage({
      tool_call_id: tc.id,
      content: JSON.stringify(result),
    });

    console.log('  工具执行结果:');
    console.log(`    ${JSON.stringify(result)}`);
    console.log();
    console.log('  构造的 ToolMessage:');
    console.log(`    tool_call_id: "${tc.id}"`);
    console.log(`    content:      ${JSON.stringify(result)}`);
    console.log(`    type:         "${toolMessage.getType()}"`);
  }
}

main().catch(console.error);
