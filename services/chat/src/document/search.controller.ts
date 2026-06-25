import { Body, Controller, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { SearchService } from './search.service';

@Controller('api/search')
@UseGuards(AuthGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * POST /api/search
   * Body: { query: string, topK?: number }
   */
  @Post()
  async search(
    @Req() req: Request,
    @Body() body: { query: string; topK?: number },
  ) {
    const userId = this.getUserId(req);
    const query = body.query?.trim();
    if (!query) {
      return { ok: false, error: 'query 不能为空' };
    }

    const topK = body.topK && body.topK > 0 && body.topK <= 20 ? body.topK : 5;

    const results = await this.searchService.similaritySearch(
      query,
      userId,
      topK,
    );

    return { ok: true, query, results };
  }
}
