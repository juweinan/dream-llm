import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import {
  DocumentService,
  ALLOWED_MIMETYPES,
  MAX_FILE_SIZE,
} from './document.service';
import { ChunkService } from './chunk.service';

@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly chunkService: ChunkService,
  ) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * POST /api/documents/upload
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async upload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { filename?: string },
  ) {
    const userId = this.getUserId(req);
    const doc = await this.documentService.upload(userId, file, body.filename);
    return { ok: true, document: doc };
  }

  /**
   * POST /api/documents/:id/process
   */
  @Post(':id/process')
  @HttpCode(202)
  async process(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    // 异步处理：解析 → 分块 → 向量化 → 落库
    const result = await this.chunkService.processDocument(id, userId);
    return {
      ok: true,
      message: '文档处理完成',
      chunkCount: result.chunkCount,
    };
  }

  /**
   * GET /api/documents
   */
  @Get()
  async list(@Req() req: Request) {
    const userId = this.getUserId(req);
    const documents = await this.documentService.findByUser(userId);
    return { ok: true, documents };
  }

  /**
   * GET /api/documents/:id
   */
  @Get(':id')
  async getOne(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    const document = await this.documentService.findById(id, userId);
    return { ok: true, document };
  }

  /**
   * DELETE /api/documents/:id
   */
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    await this.documentService.delete(id, userId);
    return { ok: true, message: '文档已删除' };
  }
}
