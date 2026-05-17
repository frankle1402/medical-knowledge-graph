import { apiClient } from '../lib/api';

export interface MaskedLlmConfig {
  base_url: string;
  model: string;
  timeout_ms: number;
  api_key_set: boolean;
  api_key_masked: string | null;
  source: {
    base_url: 'db' | 'env';
    api_key: 'db' | 'env';
    model: 'db' | 'env';
    timeout_ms: 'db' | 'env';
  };
  updated_at: string | null;
  updated_by: string | null;
}

export interface LlmConfigUpdate {
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
  timeout_ms?: number | null;
}

export interface LlmTestResult {
  ok: boolean;
  stage?: 'auth' | 'network' | 'parse' | 'config' | 'unknown';
  latency_ms?: number;
  model?: string;
  base_url?: string;
  sample_reply?: string;
  error?: string;
}

export interface LlmTestPayload {
  base_url?: string;
  api_key?: string;
  model?: string;
  timeout_ms?: number;
}

export const systemApi = {
  getLlm: () => apiClient.get<MaskedLlmConfig>('/api/system/llm'),
  updateLlm: (patch: LlmConfigUpdate) => apiClient.put<MaskedLlmConfig>('/api/system/llm', patch),
  testLlm: (payload: LlmTestPayload = {}) =>
    apiClient.post<LlmTestResult>('/api/system/llm/test', payload),
};
