// ============================================================
// UI 响应协议 — 类型定义
//
// 定义了 AI 结构化输出的完整类型体系，供 Zod Schema 和
// 前端渲染引擎使用。每个 UI 组件类型对应一种前端可渲染
// 的交互组件。
// ============================================================

// --------------- 表单字段 ---------------

export interface UIField {
  name: string;
  label: string;
  type: 'input' | 'textarea' | 'select' | 'date' | 'number';
  required?: boolean;
  placeholder?: string;
  /** 仅 type='select' 时有效 */
  options?: { label: string; value: string }[];
}

// --------------- UI 组件 ---------------

/** 纯文本 / Markdown 回复 */
export interface UIText {
  type: 'text';
  content: string;
}

/** 单选 / 多选卡片 */
export interface UISelection {
  type: 'selection';
  title: string;
  description?: string;
  mode: 'single' | 'multiple';
  options: {
    label: string;
    value: string;
    description?: string;
  }[];
}

/** 动态表单 */
export interface UIForm {
  type: 'form';
  title: string;
  description?: string;
  fields: UIField[];
  submitLabel?: string;
}

/** 确认对话框 */
export interface UIConfirmation {
  type: 'confirmation';
  title: string;
  summary: string;
  confirmLabel?: string;
  cancelLabel?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

/** 信息展示卡片（需求详情、订单详情等） */
export interface UICard {
  type: 'card';
  title: string;
  badge?: string;
  items: { label: string; value: string }[];
}

/** 步骤进度条 */
export interface UISteps {
  type: 'steps';
  currentStep: number;
  steps: {
    label: string;
    description?: string;
    status: 'completed' | 'active' | 'pending';
  }[];
}

/** 数据表格 */
export interface UITable {
  type: 'table';
  columns: {
    key: string;
    title: string;
    align?: 'left' | 'center' | 'right';
  }[];
  rows: Record<string, string>[];
}

/** 操作按钮组 */
export interface UIActionButtons {
  type: 'action_buttons';
  actions: {
    label: string;
    action: string;
    style?: 'primary' | 'default' | 'danger';
  }[];
}

// --------------- 联合类型 ---------------

export type UIComponent =
  | UIText
  | UISelection
  | UIForm
  | UIConfirmation
  | UICard
  | UISteps
  | UITable
  | UIActionButtons;

// --------------- 流程阶段 ---------------

export type SessionStage = 'select_type' | 'fill_detail' | 'confirm' | 'result';

// --------------- AI 响应 ---------------

export interface AIUIResponse {
  /** 自然语言说明，支持 Markdown */
  message: string;
  /** 需要前端渲染的 UI 组件列表，按顺序渲染 */
  components: UIComponent[];
  /** 当前所处的流程阶段 */
  sessionStage: SessionStage;
  /** 已收集的数据（供前端回显） */
  collectedData: Record<string, unknown>;
}

// --------------- 用户操作 ---------------

/** 前端 UI 组件回传的用户操作 */
export interface UIAction {
  /** 触发操作的 UI 组件类型 */
  componentType: 'selection' | 'form' | 'confirmation' | 'action_buttons';
  /** 操作的具体数据 */
  payload: {
    type: 'select' | 'submit' | 'confirm' | 'cancel' | 'click';
    [key: string]: unknown;
  };
}
