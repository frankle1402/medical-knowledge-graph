import { z } from 'zod';

/**
 * TemplateVariable — 提示词模板的变量定义。
 * type 枚举按 review-report 修订为五值：
 *   text | textarea | select | number | boolean
 * Agent-E 表单按此渲染对应控件，Agent-C 按此对 variables 赋值做类型校验。
 */
export const TemplateVariable = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'select', 'number', 'boolean']),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().default(false),
});
export type TemplateVariable = z.infer<typeof TemplateVariable>;

export const PromptTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  variables: z.array(TemplateVariable),
  system_prompt: z.string(),
  user_prompt_template: z.string(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().default(true),
  created_by: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type PromptTemplate = z.infer<typeof PromptTemplate>;

export const PromptTemplateCreateInput = PromptTemplate.pick({
  name: true,
  description: true,
  variables: true,
  system_prompt: true,
  user_prompt_template: true,
  output_schema: true,
});
export type PromptTemplateCreateInput = z.infer<typeof PromptTemplateCreateInput>;
