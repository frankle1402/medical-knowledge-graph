import type { User, UserCreateInput, UserRole } from '@mkg/shared';
import { apiClient } from '../lib/api';

export const usersApi = {
  list: () => apiClient.get<User[]>('/api/users'),
  create: (input: UserCreateInput) => apiClient.post<User>('/api/users', input),
  updateRole: (id: string, role: UserRole) =>
    apiClient.put<User>(`/api/users/${encodeURIComponent(id)}/role`, { role }),
  remove: (id: string) => apiClient.delete<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`),
};
