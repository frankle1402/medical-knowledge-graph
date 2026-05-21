import { z } from 'zod';

export const NodeType = z.enum([
  'textbook',
  'chapter',
  'section',
  'knowledge_point',
  'term',
  'operation_process',
  'operation_step',
  'competency',
  'risk',
  'error',
  'measure',
  'assessment_item',
  'image',
  'table',
  'question',
  'case',
]);
export type NodeType = z.infer<typeof NodeType>;

export const KnowledgeType = z.enum([
  '概念类',
  '目的类',
  '适应证类',
  '禁忌证类',
  '操作流程类',
  '操作要点类',
  '注意事项类',
  '异常处理类',
  '并发症类',
  '观察护理类',
  '健康教育类',
  '考点类',
]);
export type KnowledgeType = z.infer<typeof KnowledgeType>;

export const Difficulty = z.enum(['基础', '中等', '较难']);
export type Difficulty = z.infer<typeof Difficulty>;

export const Importance = z.enum(['高频考点', '重点掌握', '一般了解']);
export type Importance = z.infer<typeof Importance>;

export const CompetencyLevel = z.enum(['核心能力', '基础能力', '支持能力']);
export type CompetencyLevel = z.infer<typeof CompetencyLevel>;

export const RelationType = z.enum([
  // 教材结构
  'CONTAINS',
  'BELONGS_TO',
  'HAS_CHAPTER',
  'HAS_SECTION',
  'HAS_KNOWLEDGE_POINT',
  // 知识关系
  'PREREQUISITE_OF',
  'EASILY_CONFUSED_WITH',
  'RELATED_TO',
  // 资源
  'ILLUSTRATED_BY',
  'DESCRIBED_IN',
  'TESTED_BY',
  'APPLIED_IN',
  // 术语
  'STANDARD_TERM_OF',
  'SYNONYM_OF',
  'HAS_TERM',
  'ALIAS_OF',
  // 能力
  'SUPPORTS_COMPETENCY',
  'ASSESSED_BY',
  // 操作流程
  'HAS_PROCESS',
  'HAS_STEP',
  'NEXT_STEP',
  // 风险/错误/处理
  'HAS_RISK',
  'COMMON_ERROR_OF',
  'MANIFESTED_AS',
  'HANDLED_BY',
  'PREVENTED_BY',
  // 图谱归属
  'BELONGS_TO_GRAPH',
  'MERGED_INTO',
  'RELATED_GRAPH',
]);
export type RelationType = z.infer<typeof RelationType>;

export const NodeStatus = z.enum(['candidate', 'approved', 'rejected', 'archived']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const NodeSource = z.enum(['manual', 'ai_generated', 'imported']);
export type NodeSource = z.infer<typeof NodeSource>;

export const UserRole = z.enum(['admin', 'expert', 'operator', 'ai_service']);
export type UserRole = z.infer<typeof UserRole>;

export const GraphType = z.enum(['course', 'chapter', 'subject', 'custom']);
export type GraphType = z.infer<typeof GraphType>;
