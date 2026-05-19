/**
 * Pack D learning client.
 *
 * Backend contract (see `backend/src/modules/learning/learning.routes.ts`):
 *
 *   GET  /api/nodes/:node_id/learning-path?depth=N
 *     200: { target: {node_id, name}, path: LearningPathStep[] }
 *     404: { error: 'node_not_found' }
 *
 *   POST /api/graphs/:graph_id/knowledge-gap
 *     body: { mastered: string[], targets: string[] (>=1) }
 *     200:  { gaps: KnowledgeGap[] }
 *
 *   GET  /api/graphs/:graph_id/synonym-candidates?threshold=N
 *     threshold range 0.85..0.99 (default 0.92)
 *     200: { candidates: SynonymCandidate[] }
 *     503: { error: 'embeddings_not_ready' }  -- when <2 nodes have embeddings
 */
import { apiClient } from '../lib/api';

export interface LearningPathStep {
  node_id: string;
  name: string;
  depth: number;
  via: string;
}

export interface LearningPathResponse {
  target: { node_id: string; name: string };
  path: LearningPathStep[];
}

export interface KnowledgeGap {
  node_id: string;
  name: string;
  blocking: string[];
}

export interface KnowledgeGapResponse {
  gaps: KnowledgeGap[];
}

export interface SynonymCandidate {
  a: { node_id: string; name: string };
  b: { node_id: string; name: string };
  score: number;
}

export interface SynonymCandidatesResponse {
  candidates: SynonymCandidate[];
}

export const learningApi = {
  /**
   * Walk back along PREREQUISITE_OF edges starting at `nodeId`.
   * Returns null only via 404 (handled at call site as ApiError).
   */
  learningPath: (nodeId: string, depth = 5): Promise<LearningPathResponse> =>
    apiClient.get<LearningPathResponse>(
      `/api/nodes/${encodeURIComponent(nodeId)}/learning-path`,
      { query: { depth } },
    ),

  /**
   * Compute uncovered prerequisites for a set of `targets`, given what's
   * already `mastered`. `targets` must be non-empty.
   */
  knowledgeGap: (
    graphId: string,
    mastered: string[],
    targets: string[],
  ): Promise<KnowledgeGapResponse> =>
    apiClient.post<KnowledgeGapResponse>(
      `/api/graphs/${encodeURIComponent(graphId)}/knowledge-gap`,
      { mastered, targets },
    ),

  /**
   * List potential synonym pairs (cosine similarity >= threshold).
   * Throws ApiError(503, 'embeddings_not_ready') if backfill hasn't run.
   */
  synonymCandidates: (
    graphId: string,
    threshold = 0.92,
  ): Promise<SynonymCandidatesResponse> =>
    apiClient.get<SynonymCandidatesResponse>(
      `/api/graphs/${encodeURIComponent(graphId)}/synonym-candidates`,
      { query: { threshold } },
    ),
};
