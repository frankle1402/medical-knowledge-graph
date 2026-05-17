import type { Relation, RelationCreateInput, NodeStatus } from '@mkg/shared';
import { apiClient } from '../lib/api';

export const relationsApi = {
  list: (graphId: string) =>
    apiClient.get<Relation[]>(`/api/graphs/${encodeURIComponent(graphId)}/relations`),
  create: (graphId: string, input: RelationCreateInput) =>
    apiClient.post<Relation>(`/api/graphs/${encodeURIComponent(graphId)}/relations`, input),
  update: (
    relationId: string,
    input: { description?: string; confidence?: number; status?: NodeStatus },
  ) => apiClient.put<Relation>(`/api/relations/${encodeURIComponent(relationId)}`, input),
  remove: (relationId: string) =>
    apiClient.delete<{ ok: boolean }>(`/api/relations/${encodeURIComponent(relationId)}`),
};
