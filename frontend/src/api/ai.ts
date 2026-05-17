import type { AIGenerateRequest, AIJob } from '@mkg/shared';
import { apiClient } from '../lib/api';

export interface ApproveResult {
  ok: true;
  nodes: number;
  relations: number;
}

export const aiApi = {
  generate: (input: AIGenerateRequest) =>
    apiClient.post<{ job_id: string }>('/api/ai/generate', input),
  getJob: (jobId: string) => apiClient.get<AIJob>(`/api/ai/jobs/${encodeURIComponent(jobId)}`),
  approveAll: (jobId: string) =>
    apiClient.post<ApproveResult>(`/api/ai/jobs/${encodeURIComponent(jobId)}/approve-all`),
  approveSome: (jobId: string, body: { node_ids: string[]; relation_ids: string[] }) =>
    apiClient.post<ApproveResult>(`/api/ai/jobs/${encodeURIComponent(jobId)}/approve`, body),
  rejectAll: (jobId: string) =>
    apiClient.post<ApproveResult>(`/api/ai/jobs/${encodeURIComponent(jobId)}/reject-all`),
};
