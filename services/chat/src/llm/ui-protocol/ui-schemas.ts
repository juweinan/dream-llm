import { z } from 'zod';

// ============================================================
// UI 响应协议 — Zod Schema
//
// 使用 z.discriminatedUnion 基于 type 字段做精确匹配，
// 配合 model.withStructuredOutput() 约束 LLM 输出。
// ============================================================

// --------------- 表单字段 ---------------

const uiFieldSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('input'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal('textarea'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal('select'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    options: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      )
      .describe('可选项列表'),
  }),
  z.object({
    type: z.literal('date'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal('number'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
]);

export type UIFieldSchema = z.infer<typeof uiFieldSchema>;

// --------------- 选项 ---------------

const optionSchema = z.object({
  label: z.string().describe('选项显示文本'),
  value: z.string().describe('选项值'),
  description: z.string().optional().describe('选项补充说明'),
});

// --------------- UI 组件 ---------------

const uiTextSchema = z.object({
  type: z.literal('text'),
  content: z.string().describe('Markdown 格式的文本内容'),
});

const uiSelectionSchema = z.object({
  type: z.literal('selection'),
  title: z.string().describe('选择标题，例如"请选择需求类型"'),
  description: z.string().optional().describe('选择说明'),
  mode: z
    .enum(['single', 'multiple'])
    .describe('单选(single)或多选(multiple)'),
  options: z.array(optionSchema).describe('可选项'),
});

const uiFormSchema = z.object({
  type: z.literal('form'),
  title: z.string().describe('表单标题'),
  description: z.string().optional().describe('表单说明'),
  fields: z.array(uiFieldSchema).describe('表单字段列表'),
  submitLabel: z.string().optional().describe('提交按钮文字，默认"提交"'),
});

const uiConfirmationSchema = z.object({
  type: z.literal('confirmation'),
  title: z
    .string()
    .describe('确认标题，例如"确认执行需求分析？"'),
  summary: z.string().describe('操作摘要，说明即将执行什么'),
  confirmLabel: z.string().optional().describe('确认按钮文字'),
  cancelLabel: z.string().optional().describe('取消按钮文字'),
  riskLevel: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('风险等级'),
});

const uiCardSchema = z.object({
  type: z.literal('card'),
  title: z.string().describe('卡片标题，例如需求标题'),
  badge: z
    .string()
    .optional()
    .describe('状态标签，例如"待分析"、"已完成"'),
  items: z
    .array(
      z.object({
        label: z.string().describe('字段名，如"需求编号"'),
        value: z.string().describe('字段值，如"REQ-20240315-001"'),
      }),
    )
    .describe('键值对列表'),
});

const uiStepsSchema = z.object({
  type: z.literal('steps'),
  currentStep: z.number().describe('当前步骤序号，从 1 开始'),
  steps: z.array(
    z.object({
      label: z.string().describe('步骤名称'),
      description: z.string().optional().describe('步骤说明'),
      status: z
        .enum(['completed', 'active', 'pending'])
        .describe('步骤状态'),
    }),
  ),
});

const uiTableSchema = z.object({
  type: z.literal('table'),
  columns: z.array(
    z.object({
      key: z.string(),
      title: z.string().describe('列标题'),
      align: z.enum(['left', 'center', 'right']).optional(),
    }),
  ),
  rows: z.array(z.record(z.string(), z.string())).describe('数据行'),
});

const uiActionButtonsSchema = z.object({
  type: z.literal('action_buttons'),
  actions: z.array(
    z.object({
      label: z.string().describe('按钮文字'),
      action: z.string().describe('按钮动作标识'),
      style: z
        .enum(['primary', 'default', 'danger'])
        .optional()
        .describe('按钮样式'),
    }),
  ),
});

// --------------- 判别联合 ---------------

const uiComponentSchema = z.discriminatedUnion('type', [
  uiTextSchema,
  uiSelectionSchema,
  uiFormSchema,
  uiConfirmationSchema,
  uiCardSchema,
  uiStepsSchema,
  uiTableSchema,
  uiActionButtonsSchema,
]);

// --------------- AI 响应 ---------------

export const aiUIResponseSchema = z.object({
  message: z
    .string()
    .describe(
      '对用户输入的自然语言回复，Markdown 格式。作为 UI 组件的补充说明。',
    ),
  components: z
    .array(uiComponentSchema)
    .describe('需要渲染的 UI 组件列表，按顺序渲染。至少包含 1 个组件。'),
});

export type AIUIResponseSchema = z.infer<typeof aiUIResponseSchema>;
