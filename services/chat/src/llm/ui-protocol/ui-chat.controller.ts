import { Body, Controller, Post } from '@nestjs/common';
import { UIFlowService } from './ui-flow.service';
import type { UIAction } from './ui-types';

// ============================================================
// UI Chat Controller
//
// 提供与前端 UI 层交互的 API（无需认证，通过 sessionId 区分会话）：
// - POST /api/ui-chat/chat    : 用户输入文本，返回结构化 UI
// - POST /api/ui-chat/action  : 用户在 UI 上的操作回传
// ============================================================

@Controller('api/ui-chat')
export class UIChatController {
  constructor(private readonly uiFlow: UIFlowService) {}

  /**
   * POST /api/ui-chat/chat
   * Body: { sessionId?: string, input: string }
   */
  @Post('chat')
  async chat(@Body() body: { sessionId?: string; input: string }) {
    const sessionId =
      body.sessionId ||
      `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await this.uiFlow.handleChat(sessionId, body.input);

    return {
      ok: true,
      data: {
        ...result,
        sessionId,
      },
    };
  }

  /**
   * POST /api/ui-chat/action
   * Body: { sessionId: string, action: UIAction }
   */
  @Post('action')
  async action(@Body() body: { sessionId: string; action: UIAction }) {
    const result = await this.uiFlow.handleAction(body.sessionId, body.action);

    return {
      ok: true,
      data: {
        ...result,
        sessionId: body.sessionId,
      },
    };
  }
}
