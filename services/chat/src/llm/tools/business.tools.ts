import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs';
import { safePath, ensureDir } from '../utils/workspace.utils';

// ---------------------------------------------------------------
// query_requirement — 根据需求单号读取 JSON 文件
// ---------------------------------------------------------------

export const queryRequirementTool = tool(
  async ({ requirementId }: { requirementId: string }) => {
    const filePath = safePath(`requirements/${requirementId}.json`);

    if (!fs.existsSync(filePath)) {
      return {
        requirementId,
        found: false,
        error: `需求文件不存在: requirements/${requirementId}.json`,
      };
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      return {
        requirementId,
        found: true,
        filePath: `requirements/${requirementId}.json`,
        data,
      };
    } catch (err) {
      return {
        requirementId,
        found: false,
        error: `读取需求文件失败: ${(err as Error).message}`,
      };
    }
  },
  {
    name: 'query_requirement',
    description:
      '根据需求单号（如 REQ-2026-001）读取 workspace/requirements/{requirementId}.json 中的需求详情，包括标题、描述、约束、实体等结构化字段',
    schema: z.object({
      requirementId: z.string().describe('需求单号，如 REQ-2026-001'),
    }),
  },
);

// ---------------------------------------------------------------
// read_file — 读取 workspace 下任意文件
// ---------------------------------------------------------------

export const readFileTool = tool(
  async ({ filePath: relPath }: { filePath: string }) => {
    const filePath = safePath(relPath);

    if (!fs.existsSync(filePath)) {
      return {
        filePath: relPath,
        found: false,
        error: `文件不存在: ${relPath}`,
      };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return {
        filePath: relPath,
        found: false,
        error: `路径是目录而非文件: ${relPath}`,
      };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return {
        filePath: relPath,
        found: true,
        size: stat.size,
        content,
      };
    } catch (err) {
      return {
        filePath: relPath,
        found: false,
        error: `读取文件失败: ${(err as Error).message}`,
      };
    }
  },
  {
    name: 'read_file',
    description:
      '读取 workspace/ 目录下指定路径的文件内容，可用于查阅规范、标准、模板等参考文档。路径相对于 workspace/，如 standards/requirement-spec.md',
    schema: z.object({
      filePath: z
        .string()
        .describe(
          '相对于 workspace/ 的文件路径，如 standards/requirement-spec.md',
        ),
    }),
  },
);

// ---------------------------------------------------------------
// write_file — 将内容写入 workspace 下指定路径
// ---------------------------------------------------------------

export const writeFileTool = tool(
  async ({
    filePath: relPath,
    content,
  }: {
    filePath: string;
    content: string;
  }) => {
    const filePath = safePath(relPath);

    try {
      ensureDir(filePath);
      fs.writeFileSync(filePath, content, 'utf8');
      return {
        filePath: relPath,
        written: true,
        bytes: Buffer.byteLength(content, 'utf8'),
        message: `文件写入成功: ${relPath}`,
      };
    } catch (err) {
      return {
        filePath: relPath,
        written: false,
        error: `写入文件失败: ${(err as Error).message}`,
      };
    }
  },
  {
    name: 'write_file',
    description:
      '将内容写入 workspace/ 目录下指定路径的文件（会自动创建父目录）。可用于生成分析报告、产出制品等。路径相对于 workspace/，如 reports/REQ-2026-001-analysis.md',
    schema: z.object({
      filePath: z
        .string()
        .describe(
          '相对于 workspace/ 的目标文件路径，如 reports/REQ-2026-001-analysis.md',
        ),
      content: z.string().describe('要写入的完整文本内容'),
    }),
  },
);

// ---------------------------------------------------------------
// 工具集合
// ---------------------------------------------------------------

export const businessTools = [
  queryRequirementTool,
  readFileTool,
  writeFileTool,
];
