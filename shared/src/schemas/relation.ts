import { z } from 'zod';
import { RelationType, NodeStatus, NodeSource } from '../enums';

export const Relation = z.object({
  relation_id: z.string().optional(),
  source_id: z.string(),
  target_id: z.string(),
  relation_type: RelationType,
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
  status: NodeStatus.default('candidate'),
  source: NodeSource.default('manual'),
  ai_job_id: z.string().uuid().optional(),
  tags: z.record(z.unknown()).optional(),
  created_at: z.string().datetime().optional(),
});
export type Relation = z.infer<typeof Relation>;

/**
 * RelationCreateInput — 客户端创建关系时使用。
 * relation_id 由后端生成。status/source 不传时由后端按默认补齐
 * （status='approved'，source='manual'）。
 *
 * 显式传入 status/source 用于"代客户端代写"场景：例如同义词合并把
 * 被丢弃节点的 candidate / ai_generated 关系迁移到保留节点时，需要
 * 保留原审计来源。
 *
 * tags 用于承载 v2 提示词的扩展字段（direction_explanation /
 * evidence_quote / reason 等），落库到 relations.tags JSONB。
 */
export const RelationCreateInput = z.object({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  relation_type: RelationType,
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: NodeStatus.optional(),
  source: NodeSource.optional(),
  ai_job_id: z.string().uuid().optional(),
  tags: z.record(z.unknown()).optional(),
});
export type RelationCreateInput = z.infer<typeof RelationCreateInput>;
