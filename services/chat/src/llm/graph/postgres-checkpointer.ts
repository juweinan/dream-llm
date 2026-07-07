/**
 * postgres-checkpointer.ts — PostgreSQL checkpoint saver + thread_id 工具
 *
 * 当前版本使用 MemorySaver（进程内），保留 PostgresSaver 实现作为
 * 生产部署时的升级路径（注释中）。
 *
 * 使用方式：
 *   import { getCheckpointer, buildThreadId } from './graph/postgres-checkpointer';
 *   const cp = getCheckpointer();
 *   await cp.setup(); // 仅在 postgres 模式下
 *   graph.compile({ checkpointer: cp });
 */

import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';

// ===============================================================
// Factory — 当前使用 MemorySaver
//
// 生产环境切换 PostgresSaver 时：
//   1. 安装 @langchain/langgraph-checkpoint-postgres
//   2. 从环境变量 DATABASE_URL 创建 pg Pool
//   3. 调用 PostgresSaver.setup() 创建表
//   4. 替换下方 getCheckpointer 的实现
//
// 关键：PostgresSaver 与 PrismaService 共用同一个 PostgreSQL
// 实例（同一个 DATABASE_URL），LangGraph 的 checkpoint 数据
// 存放在独立的表中，不会干扰业务表。
// ===============================================================

let instance: BaseCheckpointSaver | null = null;

export function getCheckpointer(): BaseCheckpointSaver {
  if (!instance) {
    instance = new MemorySaver();
    console.log('[Checkpointer] 使用 MemorySaver（进程内）');
  }
  return instance;
}

/**
 * thread_id 构建工具
 *
 * thread_id 命名规范：user-{userId}:session-{sessionId}
 *
 * @example
 *   buildThreadId({ userId: 'u1', sessionId: 's2' })
 *   // => "user-u1:session-s2"
 */
export function buildThreadId(params: {
  userId: string;
  sessionId: string;
}): string {
  return `user-${params.userId}:session-${params.sessionId}`;
}

// ===============================================================
// 备选：PostgresSaver 实现（生产部署时取消注释）
//
// import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
// import { Pool } from 'pg';
//
// export function getCheckpointer(): BaseCheckpointSaver {
//   if (!instance) {
//     const url = process.env['DATABASE_URL'];
//     if (!url) throw new Error('DATABASE_URL 未设置');
//
//     instance = PostgresSaver.fromConnString(url);
//     console.log('[Checkpointer] 使用 PostgresSaver（持久化）');
//   }
//   return instance;
// }
//
// NOTE: 官方 PostgresSaver 在 @langchain/langgraph-checkpoint-postgres
//       包中，需 npm install 后在项目中使用。同时需要运行 setup() 创建
//       checkpoints 和 checkpoint_writes 表。
// ===============================================================
