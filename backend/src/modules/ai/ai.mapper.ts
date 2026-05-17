/**
 * Mapper: AIGenerateOutput (validated LLM response) → service-layer inputs.
 *
 * The LLM emits node objects with a `node_id` (e.g. "KP_1") so that relation
 * objects can reference them via source_id/target_id. We preserve these IDs
 * through the create-batch call so the relation pass can resolve cross-refs.
 *
 * Our shared `NodeCreateInput` is `passthrough()`, so any extra fields the LLM
 * emitted on a typed node (e.g. knowledge_type, page_no, aliases) are kept.
 */

import type {
  AIGenerateOutput,
  NodeCreateInput,
  RelationCreateInput,
} from '@mkg/shared';

export interface MappedCandidates {
  nodes: NodeCreateInput[];
  relations: RelationCreateInput[];
  /** Set of LLM-assigned node IDs (sanity-check input for relations). */
  knownNodeIds: Set<string>;
}

export interface MapOptions {
  /**
   * When true, drop relations whose source_id or target_id does not appear
   * in the node list. Default true. Drops are reported in `droppedRelations`
   * (not in this signature; surface via logger if needed).
   */
  dropDanglingRelations?: boolean;
}

/**
 * Convert a parsed AIGenerateOutput into bulk-create inputs.
 *
 * Behavior:
 * - Every node keeps its LLM-assigned `node_id` as a passthrough field, so the
 *   service layer can persist a stable id and let relations cross-reference.
 * - Relations referencing unknown node_ids are filtered out by default — the
 *   alternative (failing the whole job) hurts UX when the LLM hallucinates one
 *   bad reference among many good ones.
 * - All status/source/ai_job_id are NOT applied here; the orchestrator passes
 *   them as defaults to bulkCreate.
 */
export function mapLLMOutput(
  parsed: AIGenerateOutput,
  options: MapOptions = {},
): MappedCandidates {
  const dropDangling = options.dropDanglingRelations ?? true;

  const knownNodeIds = new Set<string>();
  const nodes: NodeCreateInput[] = parsed.nodes.map((n) => {
    knownNodeIds.add(n.node_id);
    // The shared Node union has many type-specific fields; we forward the full
    // object to bulkCreate (NodeCreateInput is passthrough), preserving e.g.
    // KnowledgePointNode.knowledge_type or TermNode.aliases.
    const { node_id, node_type, name, description, tags, confidence, source, ai_job_id, status, ...rest } = n;
    const out: NodeCreateInput = {
      node_type,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(ai_job_id !== undefined ? { ai_job_id } : {}),
      // Preserve the LLM-supplied node_id and any type-specific extras via
      // passthrough. We attach via spread so TS sees them as `unknown`-ish but
      // the runtime schema accepts them.
      ...(rest as Record<string, unknown>),
    };
    // Tack node_id on as a passthrough field. Tests rely on this.
    (out as Record<string, unknown>).node_id = node_id;
    if (status !== undefined) {
      (out as Record<string, unknown>).status = status;
    }
    return out;
  });

  const relations: RelationCreateInput[] = [];
  for (const r of parsed.relations) {
    if (dropDangling) {
      if (!knownNodeIds.has(r.source_id) || !knownNodeIds.has(r.target_id)) {
        continue;
      }
    }
    const item: RelationCreateInput = {
      source_id: r.source_id,
      target_id: r.target_id,
      relation_type: r.relation_type,
      ...(r.description !== undefined ? { description: r.description } : {}),
      ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
      ...(r.source !== undefined ? { source: r.source } : {}),
      ...(r.ai_job_id !== undefined ? { ai_job_id: r.ai_job_id } : {}),
    };
    relations.push(item);
  }

  return { nodes, relations, knownNodeIds };
}
