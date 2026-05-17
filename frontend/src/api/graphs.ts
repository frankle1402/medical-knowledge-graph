import type {
  Graph,
  GraphCreateInput,
  GraphUpdateInput,
  Node as KGNode,
  Relation,
} from '@mkg/shared';
import { apiClient } from '../lib/api';

export interface GraphDetail {
  graph: Graph;
  nodes: KGNode[];
  relations: Relation[];
}

export const graphsApi = {
  list: () => apiClient.get<Graph[]>('/api/graphs'),
  get: (id: string) => apiClient.get<GraphDetail>(`/api/graphs/${encodeURIComponent(id)}`),
  create: (input: GraphCreateInput) => apiClient.post<Graph>('/api/graphs', input),
  update: (id: string, input: GraphUpdateInput) =>
    apiClient.put<Graph>(`/api/graphs/${encodeURIComponent(id)}`, input),
  remove: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/api/graphs/${encodeURIComponent(id)}`),
};
