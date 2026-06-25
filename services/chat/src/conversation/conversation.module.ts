import { Module } from "@nestjs/common";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "./conversation.service";
import { MessageModule } from "../message/message.module";
import { AdvancedModule } from "../llm/advanced.module";

@Module({
  imports: [MessageModule, AdvancedModule],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
