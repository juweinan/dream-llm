import { Body, Controller, Logger, Post } from '@nestjs/common';
import { FilesystemService } from './filesystem.service';

@Controller('api/files')
export class FilesystemController {
  private readonly logger = new Logger(FilesystemController.name);

  constructor(private readonly filesystemService: FilesystemService) {}

  /**
   * POST /api/files/chat
   * Body: { input: string }
   *
   * 模型可按需调用工具读写 workspace/ 下的文件
   */
  @Post('chat')
  async chat(@Body() body: { input?: string } = {}) {
    try {
      return await this.filesystemService.chat(body.input ?? '');
    } catch (err) {
      this.logger.error('chat failed', err);
      throw err;
    }
  }
}
