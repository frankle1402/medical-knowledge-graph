import { z } from 'zod';
import { Node } from './node';
import { Relation } from './relation';

/**
 * AIGenerateRequest — POST /api/ai/generate 请求体。
 * variables 是模板填充值，按 review-report 修订需支持 string|number|boolean。
 * graph_id 可选：未传则后端新建图谱。
 */
export const AIGenerateRequest = z.object({
  template_id: z.string().uuid(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  graph_id: z.string().optional(),
});
export type AIGenerateRequest = z.infer<typeof AIGenerateRequest>;

export const AIJobStatus = z.enum(['pending', 'running', 'success', 'failed', 'partial']);
export type AIJobStatus = z.infer<typeof AIJobStatus>;

/**
 * AIGenerateOutput — LLM 直出形态。
 * 由 Agent-C 用于 Zod 校验 LLM 响应；亦作为 Agent-D/E 的 mock 数据形状基准。
 */
export const AIGenerateOutput = z.object({
  graph_name: z.string(),
  nodes: z.array(Node),
  relations: z.array(Relation),
});
export type AIGenerateOutput = z.infer<typeof AIGenerateOutput>;

// 兼容别名：review-report 要求统一命名为 AIGenerateOutput，旧名 LLMGraphOutput 保留 export 便于过渡。
export const LLMGraphOutput = AIGenerateOutput;
export type LLMGraphOutput = z.infer<typeof LLMGraphOutput>;

/**
 * GET /api/ai/jobs/:jobId 响应中复用 nodes/relations。
 * graph_name 在 graph_id 上下文里冗余，故 partial。
 */
export const AIJobOutput = AIGenerateOutput.partial({ graph_name: true });
export type AIJobOutput = z.infer<typeof AIJobOutput>;

export const AIJob = z.object({
  job_id: z.string(),
  status: AIJobStatus,
  graph_id: z.string().optional(),
  output: AIJobOutput.optional(),
  error: z.string().optional(),
  created_at: z.string().datetime().optional(),
});
export type AIJob = z.infer<typeof AIJob>;

/**
 * ApproveBody — POST /api/ai/jobs/:jobId/approve 请求体。
 * 选定要批准的 candidate 节点 / 关系 ID 列表。
 */
export const ApproveBody = z.object({
  node_ids: z.array(z.string()).default([]),
  relation_ids: z.array(z.string()).default([]),
});
export type ApproveBody = z.infer<typeof ApproveBody>;

/**
 * AIGenerationLog — 对应 Postgres `ai_generation_logs` 行，
 * 用于 GET /api/system/ai-logs 列表展示。
 */
export const AIGenerationLog = z.object({
  id: z.string().uuid(),
  graph_id: z.string().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  prompt_used: z.string().nullable().optional(),
  llm_response: z.string().nullable().optional(),
  nodes_created: z.number().int().default(0),
  relations_created: z.number().int().default(0),
  status: z.string(),
  error_msg: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
});
export type AIGenerationLog = z.infer<typeof AIGenerationLog>;

/**
 * LLMConfig — GET /api/system/llm 响应（admin 只读）。
 * 严禁回显 api_key 原文，只返回 boolean。
 */
export const LLMConfig = z.object({
  base_url: z.string(),
  model: z.string(),
  api_key_set: z.boolean(),
});
export type LLMConfig = z.infer<typeof LLMConfig>;
