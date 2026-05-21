/**
 * Mapper: AIGenerateOutput (validated LLM response) → service-layer inputs.
 *
 * The LLM emits node objects with a `node_id` (e.g. "KP_1") so that relation
 * objects can reference them via source_id/target_id. We preserve these IDs
 * through the create-batch call so the relation pass can resolve cross-refs.
 *
 * v2 (medical KG): the `nodes` table has a fixed column whitelist (see
 * `NODE_COLUMNS` in `node.service.ts`). Any extra LLM fields the schema
 * does NOT own — e.g. `step_order`, `phase`, `aliases`, `standard_term`,
 * `evidence`, `key_action` — would otherwise be silently dropped at the
 * Postgres boundary. We collapse all such extras into the `tags` JSON column
 * so the v2 prompts can emit rich metadata without a schema migration per
 * field. Legacy array-shaped tags are preserved under `tags._legacy` so the
 * existing fixtures keep working until Slice C normalizes them.
 *
 * Slice B mirrors the same trick on `relations`: extras like `reason`,
 * `direction_explanation`, and `evidence` collapse into `relations.tags`
 * (Phase 0 added the column) so the v2 prompts can attach justification to
 * each edge without expanding the typed columns.
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

// Must stay aligned with `NODE_COLUMNS` in
// backend/src/modules/nodes/node.service.ts. Anything not in this set is
// folded into `tags` rather than spread to the top level — otherwise
// `pickNodeColumns` would silently drop it.
const NODE_DB_COLUMNS = new Set([
  'node_id',
  'node_type',
  'name',
  'description',
  'knowledge_type',
  'status',
  'source',
  'confidence',
  'tags',
  'ai_job_id',
]);

// Mirror of NODE_DB_COLUMNS for relations: the persisted columns on
// `relations` plus the LLM passthroughs the service layer already understands.
// Anything not in this set is collapsed into `tags` so v2 prompt extras
// (`reason`, `direction_explanation`, `evidence`, ...) survive the bulk
// upsert into `relations.tags` JSON column (added in Phase 0 Task 0.3).
const RELATION_DB_COLUMNS = new Set([
  'source_id',
  'target_id',
  'relation_type',
  'description',
  'confidence',
  'status',
  'source',
  'ai_job_id',
  'tags',
]);

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
    const known: Record<string, unknown> = {};
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (v === undefined) continue;
      if (k === 'tags') continue; // handled separately below
      if (NODE_DB_COLUMNS.has(k)) known[k] = v;
      else extras[k] = v;
    }
    knownNodeIds.add(n.node_id as string);

    // Merge LLM-supplied tags with the extras bucket. Array-shaped tags are
    // preserved as `_legacy` so callers that still emit string[] do not lose
    // data while the v2 schema rolls out.
    const baseTags =
      Array.isArray(n.tags)
        ? { _legacy: n.tags as unknown[] }
        : n.tags && typeof n.tags === 'object'
          ? (n.tags as Record<string, unknown>)
          : {};

    const out = {
      ...known,
      tags: { ...baseTags, ...extras },
    } as unknown as NodeCreateInput;
    return out;
  });

  const relations: RelationCreateInput[] = [];
  for (const r of parsed.relations) {
    if (dropDangling) {
      if (!knownNodeIds.has(r.source_id) || !knownNodeIds.has(r.target_id)) {
        continue;
      }
    }

    // Mirror the node loop: split known DB columns from LLM extras and route
    // extras into `tags` so v2 prompts (reason / direction_explanation /
    // evidence ...) reach `relations.tags` instead of being dropped at the
    // service-layer boundary.
    const known: Record<string, unknown> = {};
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue;
      if (k === 'tags') continue; // handled separately below
      if (RELATION_DB_COLUMNS.has(k)) known[k] = v;
      else extras[k] = v;
    }

    // Merge LLM-supplied tags with the extras bucket. We only honor object-
    // shaped tags here; relations never had the legacy `string[]` form, so any
    // non-object value is treated as missing rather than wrapped under
    // `_legacy` (mirrors what `relation.service` accepts).
    const baseTags =
      r.tags && typeof r.tags === 'object' && !Array.isArray(r.tags)
        ? (r.tags as Record<string, unknown>)
        : {};

    const tags = { ...baseTags, ...extras };

    const item: RelationCreateInput = {
      ...(known as Record<string, unknown>),
      tags,
    } as unknown as RelationCreateInput;
    relations.push(item);
  }

  return { nodes, relations, knownNodeIds };
}
