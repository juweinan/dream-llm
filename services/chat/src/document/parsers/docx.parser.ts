/**
 * DOCX 解析器。
 * 使用 mammoth 将 .docx 转为纯文本。
 */
export async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}
