import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  authApi,
  systemApi,
  type MaskedLlmConfig,
  type LlmTestResult,
  type MaskedEmbeddingConfig,
  type EmbeddingTestResult,
} from '../api';
import { Button, Toaster, toast } from '../components/ui';
import { useAuthStore } from '../stores';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
};

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 4, fontWeight: 500 }}>
        {props.label}
      </div>
      {props.children}
      {props.hint ? (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{props.hint}</div>
      ) : null}
    </label>
  );
}

/**
 * Admin-only system settings. Houses two independent config sections — LLM
 * (chat completions, drives /api/ai/generate) and Embedding (vector search +
 * synonym candidates + RAG). Saves take effect immediately for every
 * subsequent call — no restart required.
 */
export function SystemSettingsPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div
      style={{ maxWidth: 760, margin: '0 auto', padding: '24px 32px' }}
      data-testid="settings-page"
    >
      <Toaster richColors position="top-right" />
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#111827' }}>系统设置</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            分别配置 LLM（对话补全）和 Embedding（向量检索）。修改后立即生效，无需重启。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => navigate('/graphs')}>
            返回图谱列表
          </Button>
          <Button variant="secondary" onClick={handleLogout}>
            退出
          </Button>
        </div>
      </header>

      <LlmConfigSection />
      <div style={{ height: 16 }} />
      <EmbeddingConfigSection />
    </div>
  );
}

// ----------------------------------------------------------------------------
// LLM section
// ----------------------------------------------------------------------------

function LlmConfigSection() {
  const [cfg, setCfg] = useState<MaskedLlmConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState<number>(120_000);

  const load = async () => {
    setLoading(true);
    try {
      const c = await systemApi.getLlm();
      setCfg(c);
      setBaseUrl(c.base_url);
      setModel(c.model);
      setTimeoutMs(c.timeout_ms);
      setApiKey('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载 LLM 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await systemApi.updateLlm({
        base_url: baseUrl || null,
        model: model || null,
        timeout_ms: timeoutMs,
        api_key: apiKey,
      });
      toast.success('LLM 配置已保存');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!confirm('清空数据库中保存的 LLM API Key？将回退到 .env 默认值。')) return;
    setSaving(true);
    try {
      await systemApi.updateLlm({ api_key: null });
      toast.success('已清空 LLM Key 覆盖');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: { base_url?: string; model?: string; api_key?: string; timeout_ms: number } = {
        timeout_ms: 30_000,
      };
      if (baseUrl) payload.base_url = baseUrl;
      if (model) payload.model = model;
      if (apiKey) payload.api_key = apiKey;
      const result = await systemApi.testLlm(payload);
      setTestResult(result);
      if (result.ok) {
        toast.success(`LLM 连接成功（${result.latency_ms}ms）`);
      } else {
        toast.error(`LLM 测试失败：${result.error ?? '未知错误'}`, { duration: 12_000 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '测试失败';
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section
      data-testid="llm-config-section"
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 24,
      }}
    >
      <h2 style={{ margin: '0 0 4px', fontSize: 16, color: '#111827' }}>LLM 配置</h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#6b7280' }}>
        用于 AI 生成图谱（chat completions）。
      </p>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : (
        <>
          {cfg ? (
            <ConfigSummary
              apiKeySet={cfg.api_key_set}
              apiKeyMasked={cfg.api_key_masked}
              apiKeySource={cfg.source.api_key}
              baseUrlSource={cfg.source.base_url}
              modelSource={cfg.source.model === 'db' ? 'db' : 'env'}
              updatedAt={cfg.updated_at}
              updatedBy={cfg.updated_by}
            />
          ) : null}

          <Field
            label="Base URL"
            hint="OpenAI 兼容前缀，如 https://api.openai.com/v1 或 https://api.deepseek.com/v1"
          >
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              style={inputStyle}
              data-testid="llm-base-url"
            />
          </Field>

          <Field label="Model" hint="如 gpt-4o-mini / deepseek-chat / glm-4">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              style={inputStyle}
              data-testid="llm-model"
            />
          </Field>

          <Field
            label="API Key"
            hint={cfg?.api_key_set ? '留空则不修改；填入则覆盖' : '尚未配置，必填'}
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg?.api_key_set ? '••••••••（保持不变）' : 'sk-...'}
              style={inputStyle}
              autoComplete="new-password"
              data-testid="llm-api-key"
            />
          </Field>

          <Field label="请求超时 (毫秒)" hint="LLM 单次调用最大等待时间，建议 60000–180000">
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              min={1000}
              max={600_000}
              step={1000}
              placeholder="120000"
              style={inputStyle}
              data-testid="llm-timeout"
            />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button onClick={handleSave} disabled={saving || testing} data-testid="llm-save">
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={saving || testing}
              data-testid="llm-test"
            >
              {testing ? '测试中…' : '测试连接'}
            </Button>
            {cfg?.api_key_set && cfg.source.api_key === 'db' ? (
              <Button variant="ghost" onClick={handleClearKey} disabled={saving || testing}>
                清空 Key 覆盖
              </Button>
            ) : null}
          </div>

          {testResult ? (
            <ResultBanner ok={testResult.ok}>
              {testResult.ok ? (
                <>
                  <div style={{ fontWeight: 600 }}>
                    ✓ 连接成功（{testResult.latency_ms ?? '?'}ms）
                  </div>
                  <div>model: {testResult.model}</div>
                  <div>base_url: {testResult.base_url}</div>
                  {testResult.sample_reply ? (
                    <div style={{ marginTop: 4 }}>
                      回包样例: <code>{testResult.sample_reply}</code>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>
                    ✗ 连接失败
                    {testResult.stage ? `（${llmStageLabel(testResult.stage)}）` : ''}
                  </div>
                  <div>{testResult.error}</div>
                </>
              )}
            </ResultBanner>
          ) : null}
        </>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Embedding section
// ----------------------------------------------------------------------------

function EmbeddingConfigSection() {
  const [cfg, setCfg] = useState<MaskedEmbeddingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState<number>(60_000);

  const load = async () => {
    setLoading(true);
    try {
      const c = await systemApi.getEmbedding();
      setCfg(c);
      setBaseUrl(c.base_url);
      setModel(c.model);
      setTimeoutMs(c.timeout_ms);
      setApiKey('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载 Embedding 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await systemApi.updateEmbedding({
        base_url: baseUrl || null,
        model: model || null,
        timeout_ms: timeoutMs,
        api_key: apiKey,
      });
      toast.success('Embedding 配置已保存');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!confirm('清空数据库中保存的 Embedding API Key？将回退到 .env 默认值。')) return;
    setSaving(true);
    try {
      await systemApi.updateEmbedding({ api_key: null });
      toast.success('已清空 Embedding Key 覆盖');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: { base_url?: string; model?: string; api_key?: string; timeout_ms: number } = {
        timeout_ms: 30_000,
      };
      if (baseUrl) payload.base_url = baseUrl;
      if (model) payload.model = model;
      if (apiKey) payload.api_key = apiKey;
      const result = await systemApi.testEmbedding(payload);
      setTestResult(result);
      if (result.ok) {
        toast.success(`Embedding 连接成功（${result.latency_ms}ms, ${result.returned_dim} 维）`);
      } else {
        toast.error(`Embedding 测试失败：${result.error ?? '未知错误'}`, { duration: 14_000 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '测试失败';
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section
      data-testid="embedding-config-section"
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 24,
      }}
    >
      <h2 style={{ margin: '0 0 4px', fontSize: 16, color: '#111827' }}>Embedding 配置</h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#6b7280' }}>
        用于语义搜索 / 同义词候选 / RAG 检索。pgvector 列固定为 <code>1536</code> 维 ——
        切换到不同维度的模型需要单独的迁移并全量 backfill。测试按钮会返回实际维度。
      </p>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : (
        <>
          {cfg ? (
            <ConfigSummary
              apiKeySet={cfg.api_key_set}
              apiKeyMasked={cfg.api_key_masked}
              apiKeySource={cfg.source.api_key}
              baseUrlSource={cfg.source.base_url}
              modelSource={cfg.source.model === 'db' ? 'db' : 'env'}
              updatedAt={cfg.updated_at}
              updatedBy={cfg.updated_by}
            />
          ) : null}

          <Field
            label="Base URL"
            hint="如 https://api.openai.com/v1（OpenAI）/ https://api.jina.ai/v1 / 本地 TEI 端点"
          >
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              style={inputStyle}
              data-testid="embedding-base-url"
            />
          </Field>

          <Field
            label="Model"
            hint="如 text-embedding-3-small（1536 维，匹配当前列宽）/ bge-m3 / jina-embeddings-v3"
          >
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="text-embedding-3-small"
              style={inputStyle}
              data-testid="embedding-model"
            />
          </Field>

          <Field
            label="API Key"
            hint={cfg?.api_key_set ? '留空则不修改；填入则覆盖' : '空时回退到 LLM 配置 / .env'}
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg?.api_key_set ? '••••••••（保持不变）' : 'sk-...'}
              style={inputStyle}
              autoComplete="new-password"
              data-testid="embedding-api-key"
            />
          </Field>

          <Field label="请求超时 (毫秒)" hint="单次 embedding 调用最大等待时间，建议 30000–120000">
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              min={1000}
              max={600_000}
              step={1000}
              placeholder="60000"
              style={inputStyle}
              data-testid="embedding-timeout"
            />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button onClick={handleSave} disabled={saving || testing} data-testid="embedding-save">
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={saving || testing}
              data-testid="embedding-test"
            >
              {testing ? '测试中…' : '测试连接'}
            </Button>
            {cfg?.api_key_set && cfg.source.api_key === 'db' ? (
              <Button variant="ghost" onClick={handleClearKey} disabled={saving || testing}>
                清空 Key 覆盖
              </Button>
            ) : null}
          </div>

          {testResult ? (
            <ResultBanner ok={testResult.ok}>
              {testResult.ok ? (
                <>
                  <div style={{ fontWeight: 600 }}>
                    ✓ 连接成功（{testResult.latency_ms ?? '?'}ms · {testResult.returned_dim} 维）
                  </div>
                  <div>model: {testResult.model}</div>
                  <div>base_url: {testResult.base_url}</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>
                    ✗ 测试失败
                    {testResult.stage ? `（${embeddingStageLabel(testResult.stage)}）` : ''}
                  </div>
                  {testResult.returned_dim != null && testResult.expected_dim != null ? (
                    <div>
                      返回 {testResult.returned_dim} 维 / 期望 {testResult.expected_dim} 维
                    </div>
                  ) : null}
                  <div>{testResult.error}</div>
                </>
              )}
            </ResultBanner>
          ) : null}
        </>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Shared bits
// ----------------------------------------------------------------------------

function ConfigSummary(props: {
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  apiKeySource: 'db' | 'env';
  baseUrlSource: 'db' | 'env';
  modelSource: 'db' | 'env';
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 16,
        fontSize: 12,
        color: '#374151',
      }}
    >
      <div>
        当前 API Key:{' '}
        {props.apiKeySet ? (
          <code style={{ color: '#059669' }}>
            {props.apiKeyMasked} ({props.apiKeySource === 'db' ? '数据库' : '.env'})
          </code>
        ) : (
          <span style={{ color: '#dc2626' }}>未配置</span>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        Base URL 来源: {props.baseUrlSource === 'db' ? '数据库' : '.env'} · Model 来源:{' '}
        {props.modelSource === 'db' ? '数据库' : '.env / 默认'}
      </div>
      {props.updatedAt ? (
        <div style={{ marginTop: 4, color: '#6b7280' }}>
          上次修改: {new Date(props.updatedAt).toLocaleString()}{' '}
          {props.updatedBy ? `· ${props.updatedBy}` : ''}
        </div>
      ) : null}
    </div>
  );
}

function ResultBanner(props: { ok: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: '12px 14px',
        borderRadius: 6,
        fontSize: 12,
        background: props.ok ? '#ecfdf5' : '#fef2f2',
        border: `1px solid ${props.ok ? '#a7f3d0' : '#fecaca'}`,
        color: props.ok ? '#065f46' : '#991b1b',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {props.children}
    </div>
  );
}

function llmStageLabel(stage: NonNullable<LlmTestResult['stage']>): string {
  switch (stage) {
    case 'auth':
      return '鉴权失败';
    case 'network':
      return '网络/超时';
    case 'parse':
      return '响应非 JSON';
    case 'config':
      return '配置缺失';
    default:
      return '未知';
  }
}

function embeddingStageLabel(stage: NonNullable<EmbeddingTestResult['stage']>): string {
  switch (stage) {
    case 'auth':
      return '鉴权失败';
    case 'network':
      return '网络/超时';
    case 'parse':
      return '响应非 JSON';
    case 'config':
      return '配置缺失';
    case 'dim_mismatch':
      return '维度不匹配';
    default:
      return '未知';
  }
}
