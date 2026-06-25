import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { SseController } from "./sse.controller";
import { SseService } from "./sse.service";
import { TaskEventController } from "./task-event.controller";
import { TaskEventService } from "./task-event.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SseController, TaskEventController],
  providers: [SseService, TaskEventService],
  exports: [SseService],
})
export class SseModule {}
