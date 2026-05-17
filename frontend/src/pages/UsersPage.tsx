import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, UserCreateInput, UserRole } from '@mkg/shared';
import { authApi, usersApi } from '../api';
import { Button, Modal, Toaster, toast } from '../components/ui';
import { useAuthStore } from '../stores';
import { ApiError } from '../lib/api';

const ROLE_OPTIONS: UserRole[] = ['admin', 'expert', 'operator', 'ai_service'];

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  expert: '专家',
  operator: '运营',
  ai_service: 'AI 服务',
};

export function UsersPage() {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await usersApi.list();
      setUsers(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleChangeRole = async (u: User, role: UserRole) => {
    if (role === u.role) return;
    try {
      const next = await usersApi.updateRole(u.id, role);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? next : x)));
      toast.success(`已将 ${u.username} 的角色改为 ${ROLE_LABEL[role]}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改角色失败');
    }
  };

  const handleDelete = async (u: User) => {
    if (u.id === me?.id) {
      toast.error('不能删除自己的账户');
      return;
    }
    if (!confirm(`确定删除用户 ${u.username}？此操作不可恢复。`)) return;
    try {
      await usersApi.remove(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success(`已删除用户 ${u.username}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CANNOT_DELETE_SELF') {
        toast.error('不能删除自己的账户');
      } else {
        toast.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  };

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
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }} data-testid="users-page">
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
          <h1 style={{ margin: 0, fontSize: 22, color: '#111827' }}>用户管理</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            管理员可在此创建用户、调整角色、删除账户。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => navigate('/graphs')}>
            返回图谱列表
          </Button>
          <Button onClick={() => setCreateOpen(true)}>新建用户</Button>
          <Button variant="secondary" onClick={handleLogout}>
            退出
          </Button>
        </div>
      </header>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : error ? (
        <p role="alert" style={{ color: '#DC2626' }}>
          {error}
        </p>
      ) : (
        <div
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table
            data-testid="users-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={thStyle}>用户名</th>
                <th style={thStyle}>邮箱</th>
                <th style={thStyle}>角色</th>
                <th style={thStyle}>创建时间</th>
                <th style={{ ...thStyle, width: 100 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={tdStyle}>
                      {u.username}
                      {isSelf ? (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: '#92400e',
                            background: '#fef3c7',
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          你自己
                        </span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>
                      {isSelf ? (
                        <span style={{ color: '#6b7280' }}>{ROLE_LABEL[u.role]}</span>
                      ) : (
                        <select
                          aria-label={`角色:${u.username}`}
                          value={u.role}
                          onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                          style={selectStyle}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td style={tdStyle}>
                      {isSelf ? (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                      ) : (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(u)}
                          aria-label={`删除:${u.username}`}
                        >
                          删除
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }}>
                    暂无用户
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(u) => {
          setUsers((prev) => [...prev, u]);
          setCreateOpen(false);
          toast.success(`已创建用户 ${u.username}`);
        }}
      />
    </div>
  );
}

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: User) => void;
}

function CreateUserDialog({ open, onClose, onCreated }: CreateUserDialogProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setRole('operator');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: UserCreateInput = { username, email, password, role };
      const created = await usersApi.create(payload);
      reset();
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
        toast.error('用户名已被占用');
      } else if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
        toast.error('邮箱已被占用');
      } else {
        toast.error(err instanceof Error ? err.message : '创建失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="新建用户" onClose={onClose} testId="create-user-modal">
      <form onSubmit={handleSubmit} aria-label="新建用户表单">
        <Field label="用户名">
          <input
            aria-label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            maxLength={50}
            style={inputStyle}
          />
        </Field>
        <Field label="邮箱">
          <input
            aria-label="邮箱"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="密码">
          <input
            aria-label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
          />
        </Field>
        <Field label="角色">
          <select
            aria-label="角色"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            style={inputStyle}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: '#6b7280',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#111827',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
  minWidth: 120,
};
