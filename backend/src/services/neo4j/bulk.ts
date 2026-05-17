import type { z } from 'zod';
import { RelationType } from '@mkg/shared';
import { NodeService, type BatchOptions } from '../../modules/nodes/node.service.js';
import {
  RelationService,
  type BatchRelationOptions,
} from '../../modules/relations/relation.service.js';

/**
 * `bulkUpsert` — single entry point used by Agent-C's AI pipeline.
 *
 * Writes nodes first (so that relation MATCH clauses can find them) then
 * relations grouped by type. The pipeline tags everything with the same
 * `ai_job_id` so downstream approve/reject can address the batch as a unit.
 *
 * Errors short-circuit; partial writes are not rolled back because Neo4j
 * Bolt driver does not expose multi-statement transactions through
 * `runQuery`. Agent-C is responsible for retries / idempotency. The MERGE
 * semantics in `createBatch` make re-runs safe.
 */
export interface BulkUpsertInput {
  graph_id: string;
  ai_job_id: string;
  nodes: Array<Record<string, unknown>>;
  relations: Array<{
    source_id: string;
    target_id: string;
    relation_type: z.infer<typeof RelationType>;
    description?: string;
    confidence?: number;
  }>;
  defaults?: {
    node_status?: BatchOptions['status'];
    relation_status?: BatchRelationOptions['status'];
    source?: BatchOptions['source'];
  };
}

export interface BulkUpsertResult {
  nodes_written: number;
  relations_written: number;
}

export async function bulkUpsert(
  input: BulkUpsertInput,
): Promise<BulkUpsertResult> {
  const nodeOpts: BatchOptions = {
    ai_job_id: input.ai_job_id,
    status: input.defaults?.node_status ?? 'candidate',
    source: input.defaults?.source ?? 'ai_generated',
  };
  const createdNodes = await NodeService.createBatch(
    input.graph_id,
    input.nodes,
    nodeOpts,
  );

  const relOpts: BatchRelationOptions = {
    ai_job_id: input.ai_job_id,
    status: input.defaults?.relation_status ?? 'candidate',
    source: input.defaults?.source ?? 'ai_generated',
  };
  // RelationType.parse happens inside RelationService.createBatch; the inputs
  // here are typed but a misbehaving caller (e.g. JS without zod) is still
  // checked at the boundary.
  const relsWritten = await RelationService.createBatch(
    input.graph_id,
    input.relations.map((r) => ({
      source_id: r.source_id,
      target_id: r.target_id,
      relation_type: r.relation_type,
      description: r.description,
      confidence: r.confidence,
    })) as never,
    relOpts,
  );

  return {
    nodes_written: createdNodes.length,
    relations_written: relsWritten,
  };
}
