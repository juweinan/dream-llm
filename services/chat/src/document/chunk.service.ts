import { Injectable, Logger } from "@nestjs/common";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { TaskStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingService } from "../llm/embedding/embedding.service";
import { SseService } from "../sse/sse.service";
import { extractText } from "./parsers/parser.factory";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const TASK_TYPE = "document_process";

@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name);
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly sse: SseService,
  ) {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
  }

  /**
   * 文档处理全流程：解析 → 分块 → 向量化 → 落库
   */
  async processDocument(documentId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc || doc.userId !== userId) {
      throw new Error("文档不存在或无权访问");
    }

    if (!doc.filePath) {
      throw new Error("文档没有关联的物理文件");
    }

    // 1. 更新状态为 processing + 推送 SSE 事件
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: "processing" },
    });
    await this.sse.emit(userId, {
      taskId: documentId,
      taskType: TASK_TYPE,
      status: TaskStatus.processing,
      message: "文档处理中…",
      metadata: { filename: doc.filename },
    });

    try {
      // 2. 解析文件 → 文本
      this.logger.log(`Parsing document ${documentId} (${doc.mimeType})`);
      const text = await extractText(doc.filePath, doc.mimeType);

      // 3. RecursiveCharacterTextSplitter 分块
      const chunkTexts = await this.splitter.splitText(text);
      this.logger.log(
        `Split document ${documentId} into ${chunkTexts.length} chunks`,
      );

      // 4. 向量化每块
      const embeddings = await this.embedding.embedDocuments(chunkTexts);

      // 5. 删除旧块（重处理场景）
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "DocumentChunk" WHERE "documentId" = $1`,
        documentId,
      );

      // 6. 逐块写入 document_chunks
      for (let i = 0; i < chunkTexts.length; i++) {
        const content = chunkTexts[i];
        const vectorStr = `[${embeddings[i].join(",")}]`;
        const id = crypto.randomUUID();

        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, "documentId", content, "chunkIndex", embedding) VALUES ($1, $2, $3, $4, $5::vector)`,
          id,
          documentId,
          content,
          i,
          vectorStr,
        );
      }

      // 7. 更新文档状态和块数量
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: "done",
          chunkCount: chunkTexts.length,
        },
      });

      // 8. 推送完成事件
      await this.sse.emit(userId, {
        taskId: documentId,
        taskType: TASK_TYPE,
        status: TaskStatus.done,
        message: `文档处理完成，共 ${chunkTexts.length} 个块`,
        metadata: { filename: doc.filename, chunkCount: chunkTexts.length },
      });

      this.logger.log(
        `Document ${documentId} processed: ${chunkTexts.length} chunks`,
      );

      return { chunkCount: chunkTexts.length };
    } catch (err) {
      this.logger.error(
        `processDocument failed for ${documentId}:`,
        err instanceof Error ? err.message : err,
      );

      await this.prisma.document
        .update({
          where: { id: documentId },
          data: { status: "error" },
        })
        .catch(() => {});

      // 推送失败事件
      await this.sse.emit(userId, {
        taskId: documentId,
        taskType: TASK_TYPE,
        status: TaskStatus.error,
        message: err instanceof Error ? err.message : "处理失败",
        metadata: { filename: doc.filename },
      }).catch(() => {});

      throw err;
    }
  }
}
