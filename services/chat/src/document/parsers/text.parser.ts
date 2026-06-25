import * as fs from "node:fs";

/**
 * TXT / Markdown 文件解析器。
 * 直接读取文件内容为 UTF-8 文本。
 */
export async function parseText(filePath: string): Promise<string> {
  return fs.readFileSync(filePath, "utf-8");
}
