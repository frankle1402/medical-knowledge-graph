import type { PromptTemplate, PromptTemplateCreateInput } from '@mkg/shared';
import { apiClient } from '../lib/api';

export const templatesApi = {
  list: () => apiClient.get<PromptTemplate[]>('/api/templates'),
  get: (id: string) => apiClient.get<PromptTemplate>(`/api/templates/${encodeURIComponent(id)}`),
  create: (input: PromptTemplateCreateInput) =>
    apiClient.post<PromptTemplate>('/api/templates', input),
  update: (id: string, input: Partial<PromptTemplateCreateInput>) =>
    apiClient.put<PromptTemplate>(`/api/templates/${encodeURIComponent(id)}`, input),
  remove: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/api/templates/${encodeURIComponent(id)}`),
};
