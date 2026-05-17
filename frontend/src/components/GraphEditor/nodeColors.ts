import type { NodeType, RelationType } from '@mkg/shared';

/** Per node_type fill color (设计文档 §6.4 + 三个层级类型). */
export const NODE_COLORS: Record<NodeType, string> = {
  textbook: '#1E40AF',
  chapter: '#2563EB',
  section: '#3B82F6',
  knowledge_point: '#3B82F6',
  term: '#10B981',
  operation_step: '#F59E0B',
  competency: '#8B5CF6',
  image: '#EC4899',
  table: '#06B6D4',
  question: '#EF4444',
  case: '#92400E',
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  textbook: '教材',
  chapter: '章',
  section: '节',
  knowledge_point: '知识点',
  term: '术语',
  operation_step: '操作步骤',
  competency: '能力',
  image: '图像',
  table: '表格',
  question: '题目',
  case: '病例',
};

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  CONTAINS: '包含',
  BELONGS_TO: '属于',
  PREREQUISITE_OF: '前置',
  EASILY_CONFUSED_WITH: '易混',
  RELATED_TO: '相关',
  ILLUSTRATED_BY: '图示',
  DESCRIBED_IN: '描述于',
  TESTED_BY: '考核',
  APPLIED_IN: '应用于',
  STANDARD_TERM_OF: '标准术语',
  SYNONYM_OF: '同义',
  SUPPORTS_COMPETENCY: '支撑能力',
  BELONGS_TO_GRAPH: '属于图谱',
  MERGED_INTO: '合并到',
  RELATED_GRAPH: '相关图谱',
};

export const CANDIDATE_BORDER = '2px dashed #9CA3AF';
export const APPROVED_BORDER = '2px solid #111827';
