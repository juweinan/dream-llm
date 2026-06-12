import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createChatModel } from '../model.factory';
import { businessTools } from '../tools/business.tools';
import { safePath, ensureDir } from '../utils/workspace.utils';

const SYSTEM_PROMPT = `你是一名需求分析助手。你可以调用文件系统工具来辅助分析：

可用工具：
- query_requirement：根据需求单号查询需求详情（JSON 文件）
- read_file：读取 workspace/ 下的规范、标准等参考文档
- write_file：将分析报告、制品写入 workspace/ 下

使用原则：
1. 当用户提到需求单号时，主动调用 query_requirement 获取详情
2. 需要查阅规范标准时，调用 read_file
3. 分析完成后，将结论写入 reports/ 目录
4. 所有路径均相对于 workspace/，不要带 workspace/ 前缀

输出要求：
- 基于工具返回的数据进行分析，不编造信息
- 如果工具返回错误（如文件不存在），如实告知用户`;

/**
 * 文件系统服务：绑定业务工具到模型，实现完整的工具执行闭环（tool-loop）
 */
@Injectable()
export class FilesystemService {
  private readonly logger = new Logger(FilesystemService.name);
  private readonly modelWithTools = createChatModel().bindTools([
    ...businessTools,
  ]);

  /**
   * 工具执行循环（参考 tool-loop 模式）：
   * 1. 将用户输入发送给带工具的模型
   * 2. 如果模型返回 tool_calls，执行对应工具并将结果反馈
   * 3. 重复直到模型给出最终文本回复
   */
  async chat(input: string): Promise<{
    input: string;
    content: string;
    toolSteps: Array<{ name: string; args: unknown; result: unknown }>;
  }> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      throw new Error('input 不能为空');
    }

    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(normalizedInput),
    ];

    const toolSteps: Array<{
      name: string;
      args: unknown;
      result: unknown;
    }> = [];

    // ---- tool-loop ----
    while (true) {
      const response = await this.modelWithTools.invoke(messages);
      messages.push(response);

      // 没有工具调用 → 模型已给出最终回复
      if (!response.tool_calls?.length) {
        return {
          input: normalizedInput,
          content: response.content.toString(),
          toolSteps,
        };
      }

      // 执行每一个工具调用
      for (const toolCall of response.tool_calls) {
        const selectedTool = businessTools.find(
          (t) => t.name === toolCall.name,
        );
        if (!selectedTool) {
          this.logger.warn(`未知工具调用: ${toolCall.name}`);
          continue;
        }

        this.logger.log(
          `[tool-loop] 调用 ${toolCall.name}(${JSON.stringify(toolCall.args)})`,
        );

        const toolExecutor = selectedTool as {
          invoke: (args: unknown) => Promise<unknown>;
        };
        const result = await toolExecutor.invoke(toolCall.args);

        toolSteps.push({
          name: toolCall.name,
          args: toolCall.args,
          result,
        });

        messages.push(
          new ToolMessage({
            tool_call_id: toolCall.id ?? toolCall.name,
            content: JSON.stringify(result),
          }),
        );
      }
    }
  }

  /**
   * 将报告内容写入 workspace/reports/ 目录（业务侧统一入口）。
   *
   * 路径和内容均由调用方指定，内部经 safePath 沙箱校验。
   *
   * @param fileName 相对于 workspace/ 的报告文件名，如 reports/analysis-s1-2026-06-12.md
   * @param content  报告文本内容
   * @returns 写入文件的绝对路径
   */
  writeReport(fileName: string, content: string): string {
    const resolved = safePath(fileName);
    ensureDir(resolved);
    fs.writeFileSync(resolved, content, 'utf8');
    this.logger.log(`Report written: ${fileName}`);
    return resolved;
  }
}
