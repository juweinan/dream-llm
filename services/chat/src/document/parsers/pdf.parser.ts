import * as fs from "node:fs";

/**
 * PDF 解析器。
 * 使用 pdf-parse 提取 PDF 中的全部文本。
 */
export async function parsePdf(filePath: string): Promise<string> {
  // pdf-parse 是 ESM 模块，用 Function 构造动态 require 绕过 Node 的 ESM 检测
  const pdfParse = (await Function('return import("pdf-parse")')()).default;
  const dataBuffer = fs.readFileSync(filePath);
  const result = await pdfParse(dataBuffer);
  return result.text;
}
