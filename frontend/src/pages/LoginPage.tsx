import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api';
import { useAuthStore } from '../stores';
import { Button } from '../components/ui';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as LocationState | null)?.from ?? '/graphs';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login({ username, password });
      setAuth(res.token, res.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
      }}
    >
      <form
        onSubmit={handleSubmit}
        aria-label="登录"
        style={{
          background: 'white',
          padding: 32,
          borderRadius: 12,
          width: 360,
          boxShadow: '0 6px 24px rgba(0,0,0,0.06)',
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: 18, color: '#111827' }}>医学知识图谱平台</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0, marginBottom: 24 }}>
          请使用您的账户登录
        </p>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={labelStyle}>用户名</span>
          <input
            aria-label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={labelStyle}>密码</span>
          <input
            aria-label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        {error ? (
          <div role="alert" style={{ color: '#DC2626', fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        ) : null}
        <Button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#374151',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};
