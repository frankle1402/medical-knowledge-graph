import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettingsPage } from '../SystemSettingsPage';
import { renderWithProviders } from '../../test/renderWithProviders';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../api', () => ({
  authApi: { logout: vi.fn().mockResolvedValue(undefined) },
  systemApi: {
    getLlm: vi.fn(),
    updateLlm: vi.fn(),
    testLlm: vi.fn(),
    getEmbedding: vi.fn(),
    updateEmbedding: vi.fn(),
    testEmbedding: vi.fn(),
  },
}));

import { systemApi } from '../../api';

const LLM_CFG = {
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  timeout_ms: 120000,
  api_key_set: true,
  api_key_masked: 'sk-a…wxyz',
  source: { base_url: 'env', api_key: 'env', model: 'env', timeout_ms: 'env' } as const,
  updated_at: null,
  updated_by: null,
};

const EMBED_CFG = {
  base_url: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  timeout_ms: 60000,
  api_key_set: true,
  api_key_masked: 'sk-a…wxyz',
  source: { base_url: 'env', api_key: 'env', model: 'default', timeout_ms: 'env' } as const,
  updated_at: null,
  updated_by: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(systemApi.getLlm).mockResolvedValue(LLM_CFG);
  vi.mocked(systemApi.getEmbedding).mockResolvedValue(EMBED_CFG);
});

describe('SystemSettingsPage', () => {
  it('renders both LLM and Embedding sections', async () => {
    renderWithProviders(<SystemSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('llm-config-section')).toBeInTheDocument();
      expect(screen.getByTestId('embedding-config-section')).toBeInTheDocument();
    });
    expect(screen.getByText(/LLM 配置/)).toBeInTheDocument();
    expect(screen.getByText(/Embedding 配置/)).toBeInTheDocument();
  });

  it('embedding test button reports dim and latency on success', async () => {
    vi.mocked(systemApi.testEmbedding).mockResolvedValue({
      ok: true,
      latency_ms: 142,
      model: 'text-embedding-3-small',
      base_url: 'https://api.openai.com/v1',
      returned_dim: 1536,
      expected_dim: 1536,
    });
    renderWithProviders(<SystemSettingsPage />);
    const btn = await screen.findByTestId('embedding-test');
    await userEvent.click(btn);
    expect(systemApi.testEmbedding).toHaveBeenCalled();
    // Banner format: ✓ 连接成功（{ms}ms · {dim} 维）
    expect(await screen.findByText(/✓ 连接成功（142ms · 1536 维）/)).toBeInTheDocument();
  });

  it('embedding test surfaces dim mismatch with the returned dim', async () => {
    vi.mocked(systemApi.testEmbedding).mockResolvedValue({
      ok: false,
      stage: 'dim_mismatch',
      latency_ms: 90,
      model: 'text-embedding-3-large',
      base_url: 'https://api.openai.com/v1',
      returned_dim: 3072,
      expected_dim: 1536,
      error: '模型返回 3072 维向量，但 pgvector 列固定为 1536 维。',
    });
    renderWithProviders(<SystemSettingsPage />);
    const btn = await screen.findByTestId('embedding-test');
    await userEvent.click(btn);
    expect(systemApi.testEmbedding).toHaveBeenCalled();
    expect(await screen.findByText(/✗ 测试失败（维度不匹配）/)).toBeInTheDocument();
    expect(await screen.findByText(/返回 3072 维 \/ 期望 1536 维/)).toBeInTheDocument();
  });
});
