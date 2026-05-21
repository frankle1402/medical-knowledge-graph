import { randomUUID } from 'node:crypto';
import type { NodeType } from '../enums';

/**
 * 节点类型 → ID 前缀（参考设计文档 §3.1 节点 ID 命名约定）。
 * 与 backend Cypher 约束（`CREATE CONSTRAINT FOR (n:KnowledgePoint) REQUIRE n.node_id`）保持一致。
 */
const NODE_PREFIX: Record<NodeType, string> = {
  textbook: 'TB',
  chapter: 'CH',
  section: 'SE',
  knowledge_point: 'KP',
  term: 'TM',
  operation_process: 'PR',
  operation_step: 'OP',
  competency: 'CP',
  risk: 'RK',
  error: 'ER',
  measure: 'MS',
  assessment_item: 'AS',
  image: 'IM',
  table: 'TA',
  question: 'QU',
  case: 'CA',
};

const tail = (len = 10): string =>
  randomUUID().replace(/-/g, '').slice(0, len).toUpperCase();

export function generateNodeId(type: NodeType): string {
  return `${NODE_PREFIX[type]}_${tail(10)}`;
}

export function generateGraphId(): string {
  return `graph_${tail(12).toLowerCase()}`;
}

export function generateRelationId(): string {
  return `rel_${tail(12).toLowerCase()}`;
}

/**
 * 校验 node_id 是否符合 `<2-3 位大写前缀>_<至少 3 位 大写字母数字>` 格式。
 * 拒绝 graph_/rel_ 等其他领域 ID（review-report P2 要求拆分）。
 */
export function isValidNodeId(id: string): boolean {
  return /^[A-Z]{2,3}_[A-Z0-9]{3,}$/.test(id);
}

export function isValidGraphId(id: string): boolean {
  return /^graph_[a-z0-9]{6,}$/.test(id);
}

export function isValidRelationId(id: string): boolean {
  return /^rel_[a-z0-9]{6,}$/.test(id);
}
