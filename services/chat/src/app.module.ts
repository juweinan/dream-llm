import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AdvancedModule } from './llm/advanced.module';
import { PrismaModule } from './prisma/prisma.module';
import { ConversationModule } from './conversation/conversation.module';
import { DocumentModule } from './document/document.module';

import { UIProtocolModule } from './llm/ui-protocol/ui-protocol.module';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    AdvancedModule,
    UIProtocolModule,
    ConversationModule,
    DocumentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
