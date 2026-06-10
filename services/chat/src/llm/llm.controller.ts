import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LlmService } from './llm.service';
import { RequirementService } from './requirement.service';

@Controller('api/langchain')
export class LlmController {
  private readonly logger = new Logger(LlmController.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly requirementService: RequirementService,
  ) {}

  @Post('invoke')
  async invoke(@Body() body: { input: string }) {
    try {
      return await this.llmService.invokeDemo(body.input);
    } catch (err) {
      this.logger.error('invokeDemo failed', err);
      throw err;
    }
  }

  @Post('structured')
  async structured(@Body() body: { input?: string } = {}) {
    try {
      return await this.requirementService.extract(body.input ?? '');
    } catch (err) {
      this.logger.error('structured failed', err);
      throw err;
    }
  }

  @Post('prompt-preview')
  async promptPreview(@Body() body: { input?: string } = {}) {
    try {
      return await this.llmService.promptPreview(body.input ?? '');
    } catch (err) {
      this.logger.error('promptPreview failed', err);
      throw err;
    }
  }

  @Post('prompt-to-model')
  async promptToModel(@Body() body: { input?: string } = {}) {
    try {
      return await this.llmService.promptToModel(body.input ?? '');
    } catch (err) {
      this.logger.error('promptToModel failed', err);
      throw err;
    }
  }

  @Post('chain-invoke')
  async chainInvoke(@Body() body: { input?: string } = {}) {
    try {
      return await this.llmService.chainInvoke(body.input ?? '');
    } catch (err) {
      this.logger.error('chainInvoke failed', err);
      throw err;
    }
  }

  @Post('chain-stream')
  async chainStream(
    @Body() body: { input?: string } = {},
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const closeConnection = () => {
      if (!res.writableEnded) {
        res.end();
      }
    };

    req.on('close', closeConnection);
    res.on('close', closeConnection);

    try {
      for await (const chunk of this.llmService.chainStream(body.input ?? '')) {
        if (res.writableEnded || res.destroyed) {
          break;
        }

        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      if (!res.writableEnded) {
        res.write('event: done\ndata: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      this.logger.error('chainStream failed', err);
      if (!res.writableEnded) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: 'chain stream failed' })}\n\n`,
        );
        res.end();
      }
    }
  }

  @Post('chain-batch')
  async chainBatch(@Body() body: { inputs?: string[] } = {}) {
    try {
      const inputs = Array.isArray(body.inputs) ? body.inputs : [];
      return await this.llmService.chainBatch(inputs);
    } catch (err) {
      this.logger.error('chainBatch failed', err);
      throw err;
    }
  }

  @Post('stream')
  async stream(
    @Body() body: { input: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const closeConnection = () => {
      if (!res.writableEnded) {
        res.end();
      }
    };

    req.on('close', closeConnection);
    res.on('close', closeConnection);

    try {
      for await (const chunk of this.llmService.stream(body.input)) {
        if (res.writableEnded || res.destroyed) {
          break;
        }

        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      if (!res.writableEnded) {
        res.write('event: done\ndata: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      this.logger.error('stream failed', err);
      if (!res.writableEnded) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: 'stream failed' })}\n\n`,
        );
        res.end();
      }
    }
  }

  @Post('batch')
  async batch(@Body() body: { inputs?: string[] } = {}) {
    try {
      const inputs = Array.isArray(body.inputs) ? body.inputs : [];
      return await this.llmService.batchDemo(inputs);
    } catch (err) {
      this.logger.error('batchDemo failed', err);
      throw err;
    }
  }
}
