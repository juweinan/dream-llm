import { parseText } from './text.parser';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';

/**
 * 根据 MIME 类型路由到对应的解析器，提取文本内容。
 */
export async function extractText(
  filePath: string,
  mimeType: string,
): Promise<string> {
  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/x-markdown'
  ) {
    return parseText(filePath);
  }

  if (mimeType === 'application/pdf') {
    return parsePdf(filePath);
  }

  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return parseDocx(filePath);
  }

  throw new Error(`不支持的 MIME 类型: ${mimeType}`);
}
