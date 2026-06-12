import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * workspace 目录绝对路径。
 * 编译后位于 dist/llm/utils/，运行于 src/llm/utils/，
 * 均需 3 层 ../ 回到 services/chat/workspace。
 */
export const WORKSPACE_ROOT = path.resolve(__dirname, '../../../workspace');

/**
 * 沙箱校验：保证所有文件读写限制在 workspace/ 目录下。
 *
 * @param relativePath 相对于 workspace/ 的路径
 * @returns 解析后的绝对路径（保证在 workspace 内）
 * @throws 路径越界或为绝对路径时抛出 Error
 */
export function safePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`不允许使用绝对路径: ${relativePath}`);
  }

  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);

  if (
    !resolved.startsWith(WORKSPACE_ROOT + path.sep) &&
    resolved !== WORKSPACE_ROOT
  ) {
    throw new Error(`路径越界，仅允许操作 workspace/ 目录: ${relativePath}`);
  }

  return resolved;
}

/**
 * 确保目标文件所在的父目录存在（递归创建）。
 */
export function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
