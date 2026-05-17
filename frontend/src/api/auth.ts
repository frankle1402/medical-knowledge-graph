import type { LoginInput, LoginResponse, User } from '@mkg/shared';
import { apiClient } from '../lib/api';

export const authApi = {
  login: (input: LoginInput) =>
    apiClient.post<LoginResponse>('/api/auth/login', input, { skipAuth: true }),
  logout: () => apiClient.post<{ ok: boolean }>('/api/auth/logout'),
  me: () => apiClient.get<User>('/api/auth/me'),
};
