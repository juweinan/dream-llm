import {
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../common/guards/auth.guard";
import { TaskEventService } from "./task-event.service";

@Controller("api/tasks")
@UseGuards(AuthGuard)
export class TaskEventController {
  private readonly logger = new Logger(TaskEventController.name);

  constructor(private readonly taskEventService: TaskEventService) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * GET /api/tasks/history?page=1&pageSize=20
   */
  @Get("history")
  async getHistory(
    @Req() req: Request,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const userId = this.getUserId(req);
    const result = await this.taskEventService.getHistory(
      userId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
    return { ok: true, ...result };
  }

  /**
   * GET /api/tasks/:taskId
   */
  @Get(":taskId")
  async getOne(@Req() req: Request, @Param("taskId") taskId: string) {
    const userId = this.getUserId(req);
    const event = await this.taskEventService.findByTaskId(taskId, userId);
    return { ok: true, event };
  }

  /**
   * PATCH /api/tasks/:taskId/read
   */
  @Patch(":taskId/read")
  async markRead(@Req() req: Request, @Param("taskId") taskId: string) {
    const userId = this.getUserId(req);
    await this.taskEventService.markRead(taskId, userId);
    return { ok: true, message: "已标记为已读" };
  }
}
