import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, systemApi, type MaskedLlmConfig, type LlmTestResult } from '../api';
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
 * Admin-only system settings. Currently houses the LLM config form.
 *
 * The backend reads this config per request via getLlmConfig(), so saves take
 * effect immediately for every subsequent AI call — no restart required.
 */
export function SystemSettingsPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
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
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    logout();
    navigate('/login', { replace: true });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await systemApi.updateLlm({
        base_url: baseUrl || null,
        model: model || null,
        timeout_ms: timeoutMs,
        api_key: apiKey,
      });
      toast.success('已保存。新配置立即对所有 AI 调用生效。');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!confirm('清空数据库中保存的 API Key？后续将回退到 .env 中的默认值。')) return;
    setSaving(true);
    try {
      await systemApi.updateLlm({ api_key: null });
      toast.success('已清空 API Key 覆盖');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败');
    } finally {
      setSaving(false);
    }
  };

  // Tests with whatever is currently in the form. We pass the form values so
  // the admin can verify a new config *before* committing it. Empty api_key
  // means "use the saved one".
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
        toast.success(`连接成功（${result.latency_ms}ms）`);
      } else {
        toast.error(`连接失败：${result.error ?? '未知错误'}`, { duration: 12_000 });
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
            配置 AI 服务接入。修改后立即生效，无需重启服务。
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

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : (
        <section
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 24,
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#111827' }}>LLM 配置</h2>

          {cfg ? (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '12px 16px',
                marginBottom: 20,
                fontSize: 12,
                color: '#374151',
              }}
            >
              <div>
                当前 API Key:{' '}
                {cfg.api_key_set ? (
                  <code style={{ color: '#059669' }}>
                    {cfg.api_key_masked} ({cfg.source.api_key === 'db' ? '数据库' : '.env'})
                  </code>
                ) : (
                  <span style={{ color: '#dc2626' }}>未配置</span>
                )}
              </div>
              <div style={{ marginTop: 4 }}>
                Base URL 来源: {cfg.source.base_url === 'db' ? '数据库' : '.env'} · Model 来源:{' '}
                {cfg.source.model === 'db' ? '数据库' : '.env'}
              </div>
              {cfg.updated_at ? (
                <div style={{ marginTop: 4, color: '#6b7280' }}>
                  上次修改: {new Date(cfg.updated_at).toLocaleString()}{' '}
                  {cfg.updated_by ? `· ${cfg.updated_by}` : ''}
                </div>
              ) : null}
            </div>
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
            />
          </Field>

          <Field label="Model" hint="如 gpt-4o-mini / deepseek-chat / glm-4">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              style={inputStyle}
            />
          </Field>

          <Field
            label="API Key"
            hint={cfg?.api_key_set ? '留空则不修改当前 Key；填入则覆盖' : '尚未配置，必填'}
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg?.api_key_set ? '••••••••（保持不变）' : 'sk-...'}
              style={inputStyle}
              autoComplete="new-password"
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
            />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
            <Button onClick={handleSave} disabled={saving || testing}>
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={saving || testing}>
              {testing ? '测试中…' : '测试连接'}
            </Button>
            {cfg?.api_key_set && cfg.source.api_key === 'db' ? (
              <Button variant="ghost" onClick={handleClearKey} disabled={saving || testing}>
                清空 Key 覆盖
              </Button>
            ) : null}
          </div>

          {testResult ? (
            <div
              style={{
                marginTop: 16,
                padding: '12px 14px',
                borderRadius: 6,
                fontSize: 12,
                background: testResult.ok ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${testResult.ok ? '#a7f3d0' : '#fecaca'}`,
                color: testResult.ok ? '#065f46' : '#991b1b',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
              role="status"
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {testResult.ok
                  ? `✓ 连接成功（${testResult.latency_ms ?? '?'}ms）`
                  : `✗ 连接失败${testResult.stage ? `（${testStageLabel(testResult.stage)}）` : ''}`}
              </div>
              {testResult.ok ? (
                <div>
                  <div>model: {testResult.model}</div>
                  <div>base_url: {testResult.base_url}</div>
                  <div style={{ marginTop: 4 }}>
                    回包样例: <code>{testResult.sample_reply}</code>
                  </div>
                </div>
              ) : (
                <div>{testResult.error}</div>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function testStageLabel(stage: NonNullable<LlmTestResult['stage']>): string {
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
