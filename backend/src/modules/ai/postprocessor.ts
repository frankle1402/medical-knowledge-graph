/**
 * AI graph post-processor.
 *
 * 在 ai.mapper 之后、bulkCreate 之前运行。做四件事：
 *  1. 按 operation_step.tags.step_order 自动补 NEXT_STEP（同一 operation_process 内）
 *  2. 对称关系（EASILY_CONFUSED_WITH / SYNONYM_OF）去重，保留无序对的一条
 *  3. RELATED_TO 占比 > 10% 时打 warning（保留数据，不删）
 *  4. 输出 warnings 数组，由 orchestrator 写到 ai_generation_logs.error_msg
 *
 * 纯函数，零副作用：入参数组用浅拷贝，新增 NEXT_STEP 走 push 到拷贝里，不
 * 触碰调用者持有的原数组。便于在 orchestrator 与单测里安全复用。
 */

import type { NodeCreateInput, RelationCreateInput } from '@mkg/shared';

/**
 * Mapper-output node shape that the postprocessor consumes. The mapper preserves
 * `node_id` / `node_type` / `tags` as passthrough fields, so we widen the
 * NodeCreateInput contract here rather than retighten it in shared.
 */
export type PostprocessNode = NodeCreateInput & {
  node_id: string;
  node_type: string;
  tags?: Record<string, unknown> | unknown[] | undefined;
};

/**
 * Mapper-output relation shape. Same reasoning as PostprocessNode — relations
 * carry endpoint ids + relation_type as required passthroughs.
 */
export type PostprocessRelation = RelationCreateInput & {
  source_id: string;
  target_id: string;
  relation_type: string;
};

export interface PostprocessInput {
  nodes: PostprocessNode[];
  relations: PostprocessRelation[];
}

export interface PostprocessOutput extends PostprocessInput {
  warnings: string[];
}

const SYMMETRIC = new Set(['EASILY_CONFUSED_WITH', 'SYNONYM_OF']);

/**
 * Pull a numeric `step_order` from a node's tags JSON, falling back to a sentinel
 * so unknown ordering lands at the tail of the sort. Tags may be the legacy
 * `string[]` shape during the v1 → v2 transition; treat it as missing.
 */
function readStepOrder(node: PostprocessNode): number {
  const tags = node.tags;
  if (!tags || Array.isArray(tags)) return Number.MAX_SAFE_INTEGER;
  const raw = (tags as Record<string, unknown>).step_order;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : Number.MAX_SAFE_INTEGER;
}

export function postprocess(input: PostprocessInput): PostprocessOutput {
  const warnings: string[] = [];
  const nodes = [...input.nodes];
  const relations = [...input.relations];

  // (1) 自动补 NEXT_STEP
  // 找每个 operation_process → 它的 HAS_STEP 子节点列表 → 按 step_order 排序 → 串成链
  const procIds = nodes
    .filter((n) => n.node_type === 'operation_process')
    .map((n) => n.node_id);
  const existingNextStep = new Set(
    relations
      .filter((r) => r.relation_type === 'NEXT_STEP')
      .map((r) => `${r.source_id}->${r.target_id}`),
  );

  for (const procId of procIds) {
    const stepIds = relations
      .filter((r) => r.source_id === procId && r.relation_type === 'HAS_STEP')
      .map((r) => r.target_id);
    const steps = stepIds
      .map((id) => nodes.find((n) => n.node_id === id))
      .filter(
        (n): n is PostprocessNode =>
          Boolean(n) && n!.node_type === 'operation_step',
      )
      .map((n) => ({ id: n.node_id, order: readStepOrder(n) }))
      .sort((a, b) => a.order - b.order);

    for (let i = 0; i < steps.length - 1; i++) {
      const key = `${steps[i]!.id}->${steps[i + 1]!.id}`;
      if (!existingNextStep.has(key)) {
        relations.push({
          source_id: steps[i]!.id,
          target_id: steps[i + 1]!.id,
          relation_type: 'NEXT_STEP',
          confidence: 0.9,
          description: 'auto-filled by postprocessor based on step_order',
        } as PostprocessRelation);
        existingNextStep.add(key);
      }
    }
  }

  // (2) 对称关系去重（保留先出现的一条）
  const seenPairs = new Set<string>();
  const dedupedRelations = relations.filter((r) => {
    if (!SYMMETRIC.has(r.relation_type)) return true;
    const [a, b] = [r.source_id, r.target_id].sort();
    const key = `${r.relation_type}:${a}|${b}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  // (3) RELATED_TO 占比检查（>10% 打 warning，不删数据）
  const totalRel = dedupedRelations.length;
  const relatedTo = dedupedRelations.filter(
    (r) => r.relation_type === 'RELATED_TO',
  ).length;
  if (totalRel > 0 && relatedTo / totalRel > 0.1) {
    warnings.push(
      `RELATED_TO 占比 ${((relatedTo / totalRel) * 100).toFixed(1)}% 超过 10%（${relatedTo}/${totalRel}），考虑改用更精确的关系类型`,
    );
  }

  return { nodes, relations: dedupedRelations, warnings };
}
