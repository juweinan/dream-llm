import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const checkConstraintValidityTool = tool(
  // 工具具体执行的函数逻辑
  async ({ constraint }: { constraint: string }) => {
    const normalizedConstraint = constraint.trim();
    const isValid = /必须|至少|不得|不能/.test(normalizedConstraint);

    return {
      constraint: normalizedConstraint,
      isValid,
      reason: isValid ? '包含明确约束关键词' : '未包含明确约束关键词',
    };
  },
  // 工具的配置对象（给模型看的）
  {
    // 工具名称（模型根据这个名称来调用工具）
    // 不能包含特殊字符，只能包含字母、数字和下划线
    name: 'check_constraint_validity',
    // 工具的描述（模型根据这个描述能更准确的调用正确的工具）
    description: '检查一条需求约束是否属于明确约束表达',
    // 工具函数的参数定义
    schema: z.object({
      constraint: z.string(),
    }),
  },
);

export const lookupEntityDefinitionTool = tool(
  async ({ entity }: { entity: string }) => {
    const normalizedEntity = entity.trim();
    const definitions: Record<string, string> = {
      用户: '系统中的业务使用者或注册主体',
      手机号: '用于身份识别、登录或绑定的手机号码字段',
      密码: '用于身份认证的安全凭证字段',
      订单: '用户提交的交易或操作记录',
      余额: '用户账户中的可用金额',
      日志: '系统记录的操作审计信息',
    };

    return {
      entity: normalizedEntity,
      definition: definitions[normalizedEntity] ?? '未找到该实体的预置定义',
    };
  },
  {
    name: 'lookup_entity_definition',
    description: '查询实体名词在需求分析场景中的定义',
    schema: z.object({
      entity: z.string(),
    }),
  },
);

export const basicTools = [
  checkConstraintValidityTool,
  lookupEntityDefinitionTool,
];
