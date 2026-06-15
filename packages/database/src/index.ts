// @autix/database — 共享 Prisma 客户端实例
// Schema 文件位于 services/user-system/prisma/schema.prisma
// 此封装提供 Prisma Client 单例 + 数据库初始化/迁移脚本

export { PrismaClient } from "@prisma/client";

// 单例 PrismaClient
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
