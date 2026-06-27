// ============================================================
// 前端 UI 响应类型定义 — 与后端 ui-types.ts 对齐
// ============================================================

export type SessionStage =
  | 'select_type'
  | 'fill_detail'
  | 'confirm'
  | 'result';

// --------------- 组件类型 ---------------

export interface UIText {
  type: 'text';
  content: string;
}

export interface UISelection {
  type: 'selection';
  title: string;
  description?: string;
  mode: 'single' | 'multiple';
  options: { label: string; value: string; description?: string }[];
}

export interface UIField {
  name: string;
  label: string;
  type: 'input' | 'textarea' | 'select' | 'date' | 'number';
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

export interface UIForm {
  type: 'form';
  title: string;
  description?: string;
  fields: UIField[];
  submitLabel?: string;
}

export interface UIConfirmation {
  type: 'confirmation';
  title: string;
  summary: string;
  confirmLabel?: string;
  cancelLabel?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface UICard {
  type: 'card';
  title: string;
  badge?: string;
  items: { label: string; value: string }[];
}

export interface UISteps {
  type: 'steps';
  currentStep: number;
  steps: { label: string; description?: string; status: 'completed' | 'active' | 'pending' }[];
}

export interface UITable {
  type: 'table';
  columns: { key: string; title: string; align?: 'left' | 'center' | 'right' }[];
  rows: Record<string, string>[];
}

export interface UIActionButtons {
  type: 'action_buttons';
  actions: { label: string; action: string; style?: 'primary' | 'default' | 'danger' }[];
}

export type UIComponent =
  | UIText
  | UISelection
  | UIForm
  | UIConfirmation
  | UICard
  | UISteps
  | UITable
  | UIActionButtons;

// --------------- API 响应 ---------------

export interface AIUIResponse {
  message: string;
  components: UIComponent[];
  sessionStage: SessionStage;
  collectedData: Record<string, unknown>;
}

// --------------- 用户操作 ---------------

export interface UIAction {
  componentType: 'selection' | 'form' | 'confirmation' | 'action_buttons';
  payload: {
    type: 'select' | 'submit' | 'confirm' | 'cancel' | 'click';
    [key: string]: unknown;
  };
}

// --------------- 聊天消息 ---------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  components: UIComponent[];
  sessionStage: SessionStage;
}
