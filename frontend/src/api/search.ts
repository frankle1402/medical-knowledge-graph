/**
 * Pack C semantic search client.
 *
 * Backend contract (see `backend/src/modules/search/search.routes.ts`):
 *   POST /api/graphs/:graph_id/search
 *   body: { q: string, k?: number (1..50), include_neighbors?: boolean }
 *   200:  { matches: [{ node, score, neighbors? }] }
 *   400:  ZodError on body
 *   404:  graph_not_found
 *   503 + Retry-After: embedding_service_unavailable (transient OpenAI failure)
 */
import { apiClient } from '../lib/api';

export interface SearchNode extends Record<string, unknown> {
  node_id: string;
  graph_id?: string;
  node_type: string;
  name: string;
}

export interface SearchMatch {
  node: SearchNode;
  score: number;
  neighbors?: SearchNode[];
}

export interface SearchResponse {
  matches: SearchMatch[];
}

export const searchApi = {
  /**
   * Run a semantic similarity search over the graph's nodes.
   *
   * @param graphId The graph to scope the search to.
   * @param q       Natural-language query (1..500 chars).
   * @param k       Top-K results (1..50, default 10).
   * @param includeNeighbors When true, each match is enriched with 1-hop neighbors.
   */
  semantic(
    graphId: string,
    q: string,
    k = 10,
    includeNeighbors = true,
  ): Promise<SearchResponse> {
    return apiClient.post<SearchResponse>(
      `/api/graphs/${encodeURIComponent(graphId)}/search`,
      { q, k, include_neighbors: includeNeighbors },
    );
  },
};
