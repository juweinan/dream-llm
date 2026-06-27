import { Injectable, Logger } from '@nestjs/common';
import { UIResponseService } from './ui-response.service';
import type {
  AIUIResponse,
  SessionStage,
  UIAction,
  UIComponent,
} from './ui-types';

// ============================================================
// UI Flow Service — 确定性状态机
//
// 需求分析交互闭环：
//   select_type → fill_detail → confirm → result
//
// 每个阶段根据 UIAction 推进，支持取消回退。
// ============================================================

interface SessionData {
  stage: SessionStage;
  requirementType?: string;
  formData?: Record<string, unknown>;
  createdAt: Date;
}

@Injectable()
export class UIFlowService {
  private readonly logger = new Logger(UIFlowService.name);
  private readonly sessions = new Map<string, SessionData>();

  constructor(private readonly uiResponse: UIResponseService) {}

  // ===============================================================
  // 公共 API
  // ===============================================================

  async handleChat(sessionId: string, input: string): Promise<AIUIResponse> {
    const session = this.getOrCreateSession(sessionId);

    const prompt = this.buildChatPrompt(session, input);
    const response = await this.uiResponse.generateUIResponse(prompt);

    return this.buildResult(session, response);
  }

  async handleAction(
    sessionId: string,
    action: UIAction,
  ): Promise<AIUIResponse> {
    const session = this.getOrCreateSession(sessionId);
    const pt = action.payload.type;

    // 根据 componentType + payload.type 联合分发
    if (action.componentType === 'selection' && pt === 'select') {
      return this.handleSelect(session, action);
    }
    if (action.componentType === 'form' && pt === 'submit') {
      return this.handleFormSubmit(session, action);
    }
    if (action.componentType === 'confirmation') {
      if (pt === 'confirm') return this.handleConfirm(session);
      if (pt === 'cancel') return this.handleCancel(session);
    }
    if (action.componentType === 'action_buttons' && pt === 'click') {
      return this.handleButtonClick(session, action);
    }

    return this.unknownActionResponse(session);
  }

  // ===============================================================
  // Stage 处理器
  // ===============================================================

  /** Stage: select_type → fill_detail */
  private async handleSelect(
    session: SessionData,
    action: UIAction,
  ): Promise<AIUIResponse> {
    const selected = action.payload['selectedId'] as string;
    session.stage = 'fill_detail';
    session.requirementType = selected;
    this.logger.log(`select: ${selected} → fill_detail`);

    const response = await this.uiResponse.generateUIResponse(
      `用户选择了需求类型「${selected}」。请生成一个需求详情收集表单，` +
        `让用户填写需求的完整信息（标题、描述、优先级、目标用户、期望结果、验收标准等）。` +
        `表单字段类型要丰富（input/textarea/select），贴近需求分析业务。`,
    );

    return this.buildResult(session, response);
  }

  /** Stage: fill_detail → confirm */
  private async handleFormSubmit(
    session: SessionData,
    action: UIAction,
  ): Promise<AIUIResponse> {
    const formData = action.payload['formData'] as Record<string, unknown>;
    session.stage = 'confirm';
    session.formData = formData;
    this.logger.log(`form_submit → confirm`);

    const formDataStr = JSON.stringify(formData, null, 2);
    const response = await this.uiResponse.generateUIResponse(
      `需求信息已收集完成。请根据以下真实数据生成确认内容，**禁止编造任何与数据不符的信息**：\n\n` +
        `需求类型: ${session.requirementType}\n` +
        `用户提交的表单数据:\n${formDataStr}\n\n` +
        `请生成：\n` +
        `1. 一个 card 组件，展示上述表单中的真实数据作为需求摘要\n` +
        `2. 一个 confirmation 组件，标题为"确认提交需求分析"，摘要中引用上述真实数据\n` +
        `3. 一个 steps 组件，展示五个分析步骤（需求提取 → 需求澄清 → 需求分析 → 风险评估 → 汇总报告），当前第 1 步为 active，其余为 pending`,
    );

    return this.buildResult(session, response);
  }

  /** Stage: confirm → result */
  private async handleConfirm(session: SessionData): Promise<AIUIResponse> {
    session.stage = 'result';
    this.logger.log(`confirm → result`);

    const response = await this.uiResponse.generateUIResponse(
      `用户已确认提交需求分析。请生成：\n` +
        `1. 一个 steps 组件，展示分析流程进度，5 个步骤：` +
        `需求提取（completed）、需求澄清（active）、需求分析（pending）、风险评估（pending）、汇总报告（pending），当前步骤为第 2 步\n` +
        `2. 一个 action_buttons 组件，包含以下操作：` +
        `"查看进度"（view_progress）、"查看报告"（view_report）、"新建需求"（new_requirement）`,
    );

    return this.buildResult(session, response);
  }

  /** 取消操作：回退到上一阶段 */
  private async handleCancel(session: SessionData): Promise<AIUIResponse> {
    const prevStage = session.stage;
    switch (session.stage) {
      case 'fill_detail':
        session.stage = 'select_type';
        break;
      case 'confirm':
        session.stage = 'fill_detail';
        break;
      case 'result':
        session.stage = 'confirm';
        break;
      default:
        break; // select_type 取消 = 保持不动
    }
    this.logger.log(`cancel: ${prevStage} → ${session.stage}`);

    const needsSelection =
      session.stage === 'select_type'
        ? '用 selection 组件让用户重新选择需求类型。'
        : '';

    const response = await this.uiResponse.generateUIResponse(
      `用户取消了操作，当前回退到「${session.stage}」阶段。请生成合适的回复和 UI 组件。${needsSelection}`,
    );

    return this.buildResult(session, response);
  }

  /** 按钮操作 */
  private async handleButtonClick(
    session: SessionData,
    action: UIAction,
  ): Promise<AIUIResponse> {
    const btnAction = action.payload['action'] as string;
    this.logger.log(`button_click: ${btnAction}`);

    switch (btnAction) {
      case 'new_requirement':
        session.stage = 'select_type';
        delete session.requirementType;
        delete session.formData;
        return this.buildResult(
          session,
          await this.uiResponse.generateUIResponse(
            '用户想提交新需求。请用 selection 组件让用户选择需求类型。',
          ),
        );

      case 'view_report':
        return this.buildResult(
          session,
          await this.uiResponse.generateUIResponse(
            '分析已完成。请用 steps 组件展示 5 个步骤全部 completed。' +
              '并用 action_buttons 提供"导出报告"（export_report）、"新建需求"（new_requirement）、"查看详情"（view_detail）。',
          ),
        );

      case 'export_report':
        return this.buildResult(
          session,
          await this.uiResponse.generateUIResponse(
            '用户需要导出报告。请生成一个 text 组件说明报告已生成，' +
              '并用 action_buttons 提供"下载 PDF"、"下载 Markdown"、"新建需求"。',
          ),
        );

      default:
        return this.buildResult(
          session,
          await this.uiResponse.generateUIResponse(
            `用户点击了「${btnAction}」。请根据当前处于「${session.stage}」阶段生成合适回复。`,
          ),
        );
    }
  }

  // ===============================================================
  // 内部工具
  // ===============================================================

  private getOrCreateSession(sessionId: string): SessionData {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        stage: 'select_type',
        createdAt: new Date(),
      });
      this.logger.log(`新会话: ${sessionId}`);
    }
    return this.sessions.get(sessionId)!;
  }

  private buildChatPrompt(session: SessionData, input: string): string {
    const stage = session.stage;
    const type = session.requirementType ?? '未选择';
    const data = JSON.stringify(session.formData ?? {});

    switch (stage) {
      case 'select_type':
        return (
          `[当前阶段: 选择需求类型]\n用户输入: ${input}\n` +
          `判断用户意图：如果用户想提新需求，请用 selection 组件让用户选择需求类型` +
          `（功能性需求、性能需求、安全需求、可用性需求、兼容性需求、其他）。`
        );

      case 'fill_detail':
        return (
          `[当前阶段: 填写需求详情]\n` +
          `已选需求类型: ${type}\n已收集数据: ${data}\n` +
          `用户输入: ${input}\n` +
          `请根据用户输入更新表单数据，并用 form 组件让用户继续填写或修改。`
        );

      case 'confirm':
        return (
          `[当前阶段: 确认提交]\n` +
          `需求类型: ${type}\n表单数据: ${data}\n` +
          `用户输入: ${input}\n` +
          `如果用户表达确认意图，请生成 card（摘要）+ confirmation（确认对话框）+ steps（展示 5 步流程）。如果用户要修改，请回退到表单阶段。`
        );

      case 'result':
        return (
          `[当前阶段: 查看结果]\n` +
          `需求类型: ${type}\n用户输入: ${input}\n` +
          `请用 steps 展示进度，用 action_buttons 提供后续操作。`
        );

      default:
        return input;
    }
  }

  private buildResult(
    session: SessionData,
    response: { message: string; components: UIComponent[] },
  ): AIUIResponse {
    return {
      message: response.message,
      components: response.components,
      sessionStage: session.stage,
      collectedData: {
        requirementType: session.requirementType,
        ...session.formData,
      },
    };
  }

  private async unknownActionResponse(
    session: SessionData,
  ): Promise<AIUIResponse> {
    return this.buildResult(
      session,
      await this.uiResponse.generateUIResponse('未知操作类型'),
    );
  }
}
