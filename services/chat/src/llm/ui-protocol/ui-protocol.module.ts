import { Module } from '@nestjs/common';
import { UIChatController } from './ui-chat.controller';
import { UIResponseService } from './ui-response.service';
import { UIFlowService } from './ui-flow.service';

@Module({
  controllers: [UIChatController],
  providers: [UIResponseService, UIFlowService],
  exports: [UIResponseService, UIFlowService],
})
export class UIProtocolModule {}
