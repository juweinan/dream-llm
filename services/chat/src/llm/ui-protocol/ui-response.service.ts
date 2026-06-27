import { Injectable } from '@nestjs/common';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createChatModel } from '../model.factory';
import { aiUIResponseSchema, type AIUIResponseSchema } from './ui-schemas';

// ============================================================
// UI 响应服务
//
// 使用 model.withStructuredOutput() 约束 LLM 输出，
// 生成包含 UI 组件的结构化回复。
// ============================================================

const SYSTEM_PROMPT = `你是一个需求分析系统的智能助手。你需要根据对话场景，选择最合适的 UI 组件来辅助交互。

## 可用的 UI 组件类型

### text — 纯文本/Markdown
用于：普通回复、解释说明、分析报告
示例场景：用户问"什么是需求分析"时

### selection — 选择卡片
用于：让用户在预设选项中做选择
示例场景：
- 用户要提新需求 → 展示需求类型让用户选择（功能需求、性能需求、安全需求…）
- 用户想筛选需求列表 → 展示筛选维度
注意事项：mode 为 single 表示单选，multiple 表示多选

### form — 动态表单
用于：收集结构化的用户输入
示例场景：
- 用户确认需求类型后 → 展示表单收集需求详细信息
- 用户要创建需求 → 展示需求创建表单
支持的字段类型：input(文本), textarea(多行文本), select(下拉), date(日期), number(数字)

### confirmation — 确认对话框
用于：在执行重要操作前让用户确认
示例场景：
- 用户提交需求分析 → 展示分析摘要 + 确认/取消按钮
- 删除需求 → 展示风险提示 + 确认
注意事项：高风险操作应设置 riskLevel

### card — 信息展示卡片
用于：展示单个实体的结构化信息
示例场景：
- 用户查询某个需求 → 以卡片展示需求编号、状态、优先级等
- 展示订单/项目详情

### steps — 步骤进度条
用于：展示多步骤流程的当前进度
示例场景：
- 需求分析流程：提取 → 澄清 → 分析 → 风险评估 → 汇总
- 配合 confirmation 使用，展示即将执行的步骤

### table — 数据表格
用于：批量展示多条结构化数据
示例场景：
- 用户查询需求列表 → 表格展示多条需求
- 展示某个分析结果的多维度对比

### action_buttons — 操作按钮组
用于：在回复末尾提供后续操作入口
示例场景：
- 分析完成后 → 提供"导出报告"/"查看详情"/"新建需求"等按钮
- 展示需求详情后 → "编辑"/"删除"/"发起分析"

## 核心规则
1. 每个请求必须回复 message（自然语言说明）+ 至少 1 个合适的 UI 组件
2. 如果场景不需要交互（纯答疑），至少返回 text 组件
3. 可以同时返回多个不同类型的组件（如 card + action_buttons）
4. 组件要贴合需求分析业务场景：需求提取、澄清、分析、风险评估、汇总报告
5. 标记语言使用中文，保持专业、友好`;

@Injectable()
export class UIResponseService {
  private model = createChatModel();

  /**
   * 根据用户输入和对话上下文，生成包含 UI 组件的结构化回复。
   *
   * @param input      用户当前输入
   * @param history    对话历史（LangChain 消息格式）
   * @param context    额外上下文（如检索到的知识库文档）
   */
  async generateUIResponse(
    input: string,
    history?: BaseMessage[],
    context?: string,
  ): Promise<AIUIResponseSchema> {
    const structuredModel = this.model.withStructuredOutput(aiUIResponseSchema);

    const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

    if (history && history.length > 0) {
      messages.push(...history);
    }

    if (context) {
      messages.push(
        new SystemMessage(
          `【参考上下文】以下是知识库中检索到的相关文档内容，请结合这些信息回复用户：\n${context}`,
        ),
      );
    }

    messages.push(new HumanMessage(input));

    return structuredModel.invoke(messages);
  }
}
