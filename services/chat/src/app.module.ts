import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { LlmModule } from "./llm/llm.module";
import { AdvancedModule } from "./llm/advanced.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ConversationModule } from "./conversation/conversation.module";

@Module({
  imports: [PrismaModule, LlmModule, AdvancedModule, ConversationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
