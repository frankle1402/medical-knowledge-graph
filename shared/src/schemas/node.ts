import { z } from 'zod';
import {
  NodeType,
  KnowledgeType,
  Difficulty,
  Importance,
  CompetencyLevel,
  NodeStatus,
  NodeSource,
} from '../enums';

/**
 * `tags` 字段在 v2 之前是 `string[]`，v2 起改为 JSON 对象，承载 LLM 输出的扩展字段
 * （step_order / phase / aliases / standard_term / evidence ...）。
 * 为保留旧测试 fixture（`tags: []` / `tags: ['x']`），这里用 union 接两种形态——
 * 落库前 `node.service.ts` 会把数组态包成 `{ _legacy: [...] }` 或视为空对象。
 */
const TagsValue = z
  .union([
    z.array(z.string()),
    z.record(z.string(), z.unknown()),
  ])
  .default({});

/**
 * 节点公共字段。所有具体类型 extend 此 schema。
 * `ai_job_id` 由 Agent-C/Agent-B 协议要求，AI 生成时携带，便于按 job 批量审核 / 撤销。
 */
export const BaseNode = z.object({
  node_id: z.string().min(1),
  node_type: NodeType,
  name: z.string().min(1),
  status: NodeStatus.default('candidate'),
  confidence: z.number().min(0).max(1).default(1),
  source: NodeSource.default('manual'),
  description: z.string().optional(),
  tags: TagsValue,
  ai_job_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  created_by: z.string().optional(),
});
export type BaseNode = z.infer<typeof BaseNode>;

export const TextbookNode = BaseNode.extend({
  node_type: z.literal('textbook'),
  edition: z.string().optional(),
  publisher: z.string().optional(),
  publish_year: z.number().int().optional(),
});
export type TextbookNode = z.infer<typeof TextbookNode>;

export const ChapterNode = BaseNode.extend({
  node_type: z.literal('chapter'),
  chapter_no: z.string().optional(),
  page_range: z.string().optional(),
});
export type ChapterNode = z.infer<typeof ChapterNode>;

export const SectionNode = BaseNode.extend({
  node_type: z.literal('section'),
  section_no: z.string().optional(),
});
export type SectionNode = z.infer<typeof SectionNode>;

export const KnowledgePointNode = BaseNode.extend({
  node_type: z.literal('knowledge_point'),
  textbook: z.string().optional(),
  edition: z.string().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
  page_no: z.number().int().optional(),
  knowledge_type: KnowledgeType,
  difficulty: Difficulty.optional(),
  importance: Importance.optional(),
});
export type KnowledgePointNode = z.infer<typeof KnowledgePointNode>;

export const TermNode = BaseNode.extend({
  node_type: z.literal('term'),
  standard_term: z.string(),
  aliases: z.array(z.string()).default([]),
  english: z.string().optional(),
  category: z.string().optional(),
});
export type TermNode = z.infer<typeof TermNode>;

export const OperationStepNode = BaseNode.extend({
  node_type: z.literal('operation_step'),
  step_order: z.number().int(),
  phase: z.string(),
});
export type OperationStepNode = z.infer<typeof OperationStepNode>;

export const CompetencyNode = BaseNode.extend({
  node_type: z.literal('competency'),
  competency_level: CompetencyLevel.optional(),
  domain: z.string().optional(),
});
export type CompetencyNode = z.infer<typeof CompetencyNode>;

export const ImageNode = BaseNode.extend({
  node_type: z.literal('image'),
  url: z.string().optional(),
  caption: z.string().optional(),
});
export type ImageNode = z.infer<typeof ImageNode>;

export const TableNode = BaseNode.extend({
  node_type: z.literal('table'),
  columns: z.array(z.string()).optional(),
  summary: z.string().optional(),
});
export type TableNode = z.infer<typeof TableNode>;

export const QuestionNode = BaseNode.extend({
  node_type: z.literal('question'),
  question_type: z.string(),
  difficulty: Difficulty.optional(),
  exam_scene: z.string().optional(),
  cognitive_level: z.string().optional(),
});
export type QuestionNode = z.infer<typeof QuestionNode>;

export const CaseNode = BaseNode.extend({
  node_type: z.literal('case'),
  case_type: z.string(),
  scene: z.string().optional(),
  symptoms: z.array(z.string()).default([]),
  teaching_objectives: z.array(z.string()).default([]),
});
export type CaseNode = z.infer<typeof CaseNode>;

export const Node = z.discriminatedUnion('node_type', [
  TextbookNode,
  ChapterNode,
  SectionNode,
  KnowledgePointNode,
  TermNode,
  OperationStepNode,
  CompetencyNode,
  ImageNode,
  TableNode,
  QuestionNode,
  CaseNode,
]);
export type Node = z.infer<typeof Node>;

/**
 * NodeCreateInput — 客户端创建节点时使用。
 * 与 Node 一致但 `node_id` 由后端生成（参考 utils/id.ts），故移除必填约束。
 * 这里使用宽松对象（passthrough）保留各类型扩展字段，由路由层在落库前再用具体 NodeXxx schema 校验。
 */
export const NodeCreateInput = z
  .object({
    node_type: NodeType,
    name: z.string().min(1),
    description: z.string().optional(),
    tags: TagsValue.optional(),
    confidence: z.number().min(0).max(1).optional(),
    source: NodeSource.optional(),
    ai_job_id: z.string().uuid().optional(),
  })
  .passthrough();
export type NodeCreateInput = z.infer<typeof NodeCreateInput>;

/**
 * NodeUpdateInput — 客户端更新节点。所有字段可选；node_type 不允许修改。
 */
export const NodeUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: TagsValue.optional(),
    status: NodeStatus.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type NodeUpdateInput = z.infer<typeof NodeUpdateInput>;
