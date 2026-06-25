import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

const ALLOWED_MIMETYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export { ALLOWED_MIMETYPES, MAX_FILE_SIZE };

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(userId: string, file: Express.Multer.File, filename?: string) {
    const name = filename || file.originalname;
    const dir = path.join(UPLOADS_DIR, userId);
    fs.mkdirSync(dir, { recursive: true });

    const storedName = `${Date.now()}-${name}`;
    const filePath = path.join(dir, storedName);
    fs.writeFileSync(filePath, file.buffer);

    return this.prisma.document.create({
      data: {
        userId,
        filename: name,
        mimeType: file.mimetype,
        size: file.size,
        filePath,
        status: 'pending',
      },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(documentId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    if (doc.userId !== userId) {
      throw new NotFoundException('无权访问此文档');
    }

    return doc;
  }

  async delete(documentId: string, userId: string) {
    const doc = await this.findById(documentId, userId);

    // 删除物理文件
    if (doc.filePath && fs.existsSync(doc.filePath)) {
      fs.unlinkSync(doc.filePath);
    }

    return this.prisma.document.delete({
      where: { id: documentId },
    });
  }

  async markProcessing(documentId: string, userId: string) {
    await this.findById(documentId, userId);
    return this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'processing' },
    });
  }
}
