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
  created_at: z.string().datetime().optional(),
});
export type Relation = z.infer<typeof Relation>;

/**
 * RelationCreateInput — 客户端创建关系时使用。
 * relation_id 由后端生成；status/source 默认值由后端落库时补齐。
 */
export const RelationCreateInput = z.object({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  relation_type: RelationType,
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: NodeSource.optional(),
  ai_job_id: z.string().uuid().optional(),
});
export type RelationCreateInput = z.infer<typeof RelationCreateInput>;
