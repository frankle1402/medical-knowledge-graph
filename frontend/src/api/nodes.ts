import type {
  Node as KGNode,
  NodeCreateInput,
  NodeUpdateInput,
  NodeType,
  NodeStatus,
} from '@mkg/shared';
import { apiClient } from '../lib/api';

export interface NodesListQuery {
  node_type?: NodeType;
  status?: NodeStatus;
  keyword?: string;
  skip?: number;
  limit?: number;
}

export const nodesApi = {
  list: (graphId: string, query: NodesListQuery = {}) => {
    const q: Record<string, string | number | boolean | undefined | null> = {
      node_type: query.node_type,
      status: query.status,
      keyword: query.keyword,
      skip: query.skip,
      limit: query.limit,
    };
    return apiClient.get<{ items: KGNode[]; total?: number }>(
      `/api/graphs/${encodeURIComponent(graphId)}/nodes`,
      { query: q },
    );
  },
  create: (graphId: string, input: NodeCreateInput) =>
    apiClient.post<KGNode>(`/api/graphs/${encodeURIComponent(graphId)}/nodes`, input),
  update: (nodeId: string, input: NodeUpdateInput) =>
    apiClient.put<KGNode>(`/api/nodes/${encodeURIComponent(nodeId)}`, input),
  remove: (nodeId: string) =>
    apiClient.delete<{ ok: boolean }>(`/api/nodes/${encodeURIComponent(nodeId)}`),
};
