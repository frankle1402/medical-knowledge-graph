# Agent-E — 前端管理后台 / 审核 UI 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 实现登录页、图谱列表页、AI 模板管理（管理员）、用户管理（管理员）、AI 生成面板与审核面板（设计文档 §6.1 §6.3 §7）。

**架构（Architecture）:** 复用 Agent-D 的 Vite + React + Tailwind + shadcn 工程，单一入口 `App.tsx` 由 React Router 驱动多页面；权限控制以 `useAuth().role` 为准，路由级 `<RequireRole>` 守卫；表单用 RHF + Zod；与后端通信走 `lib/api.ts`（Agent-D 维护）。

**技术栈:** React Router 6 · TanStack Query · React Hook Form · shadcn/ui（Dialog、Table、Form、Tabs、Toast）· `@mkg/shared`。

---

## 工作分支

`feature/agent-e-frontend-admin`

## 输出目录（仅本 Agent 可写）

- `frontend/src/pages/login/`
- `frontend/src/pages/graphs/list/`
- `frontend/src/pages/admin/templates/`
- `frontend/src/pages/admin/users/`
- `frontend/src/pages/admin/settings/`
- `frontend/src/components/AIGeneratePanel/`
- `frontend/src/components/ReviewPanel/`
- `frontend/src/components/TemplateManager/`
- `frontend/src/components/RequireRole.tsx`
- `frontend/src/store/auth.ts`
- `frontend/src/api/auth.ts`、`api/templates.ts`、`api/users.ts`、`api/ai.ts`

## 关键依赖

- ✅ Agent-D `Task 1-3`（frontend 骨架 + api client + msw）已就绪
- ✅ Agent-A 的 `/api/auth/login`、`/api/templates`、`/api/users` 联通
- ✅ Agent-C 的 `/api/ai/generate`、`/api/ai/jobs/:id`、`/api/ai/jobs/:id/approve(-all)` 联通

---

## Task 1：Auth Store 与登录页

**Files:**
- Create: `frontend/src/store/auth.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/pages/login/LoginPage.tsx`
- Create: `frontend/src/pages/login/__tests__/LoginPage.test.tsx`

**Step 1：写测试（登录成功跳 /graphs）**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../LoginPage';

vi.mock('@/api/auth', () => ({
  login: vi.fn().mockResolvedValue({ token: 't', user: { id: 'u', username: 'admin', role: 'admin' } }),
}));

describe('LoginPage', () => {
  it('提交登录后调用 login 接口', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/用户名/), 'admin');
    await userEvent.type(screen.getByLabelText(/密码/), 'admin123');
    await userEvent.click(screen.getByRole('button', { name: /登录/ }));
    const { login } = await import('@/api/auth');
    expect(login).toHaveBeenCalledWith('admin', 'admin123');
  });
});
```

**Step 2：实现 `store/auth.ts`**

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@mkg/shared';

interface AuthState {
  token: string | null;
  user: { id: string; username: string; role: UserRole } | null;
  setAuth: (token: string, user: AuthState['user']) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'mkg-auth' },
  ),
);
```

**Step 3：实现 `api/auth.ts`**

```ts
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/store/auth';

export async function login(username: string, password: string) {
  const { data } = await api.post('/api/auth/login', { username, password });
  setToken(data.token);
  useAuth.getState().setAuth(data.token, data.user);
  return data;
}

export function logout() {
  setToken(null);
  useAuth.getState().clear();
}
```

**Step 4：实现 `pages/login/LoginPage.tsx`**

```tsx
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { login } from '@/api/auth';

type FormData = { username: string; password: string };

export function LoginPage() {
  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<FormData>();
  const navigate = useNavigate();
  const onSubmit = async (data: FormData) => {
    await login(data.username, data.password);
    navigate('/graphs');
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white p-8 rounded-lg shadow-md w-80 space-y-4">
        <h1 className="text-xl font-bold">医学知识图谱平台登录</h1>
        <div>
          <label className="block text-sm">用户名</label>
          <input className="w-full border rounded px-2 py-1" {...register('username', { required: true })} />
          {errors.username && <span className="text-red-500 text-xs">必填</span>}
        </div>
        <div>
          <label className="block text-sm">密码</label>
          <input type="password" className="w-full border rounded px-2 py-1" {...register('password', { required: true })} />
        </div>
        <button disabled={isSubmitting} className="w-full bg-blue-600 text-white rounded py-2">登录</button>
      </form>
    </div>
  );
}
```

**Step 5：测试通过 + Commit**

```powershell
git add frontend/src/store/auth.ts frontend/src/api/auth.ts frontend/src/pages/login
git commit -m "feat(agent-e): add login page and auth store"
```

---

## Task 2：`<RequireRole>` 路由守卫

**Files:**
- Create: `frontend/src/components/RequireRole.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1：实现**

```tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import type { UserRole } from '@mkg/shared';

export function RequireRole({
  roles,
  children,
}: {
  roles?: UserRole[];
  children: React.ReactNode;
}) {
  const { token, user } = useAuth();
  const loc = useLocation();
  if (!token || !user) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (roles && !roles.includes(user.role)) {
    return <div className="p-8 text-red-500">无权限访问</div>;
  }
  return <>{children}</>;
}
```

**Step 2：在 `App.tsx` 中应用路由**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/login/LoginPage';
import { GraphListPage } from './pages/graphs/list/GraphListPage';
import { GraphEditorPage } from './pages/graphs/edit/GraphEditorPage';
import { TemplateManagerPage } from './pages/admin/templates/TemplateManagerPage';
import { UserManagerPage } from './pages/admin/users/UserManagerPage';
import { SettingsPage } from './pages/admin/settings/SettingsPage';
import { RequireRole } from './components/RequireRole';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/graphs" element={<RequireRole><GraphListPage /></RequireRole>} />
        <Route path="/graphs/:id/edit" element={<RequireRole><GraphEditorPage /></RequireRole>} />
        <Route path="/admin/templates" element={<RequireRole roles={['admin']}><TemplateManagerPage /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole roles={['admin']}><UserManagerPage /></RequireRole>} />
        <Route path="/admin/settings" element={<RequireRole roles={['admin']}><SettingsPage /></RequireRole>} />
        <Route path="*" element={<Navigate to="/graphs" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 3：Commit**

```powershell
git add frontend/src/components/RequireRole.tsx frontend/src/App.tsx
git commit -m "feat(agent-e): add role-based route guard"
```

---

## Task 3：图谱列表页

**Files:**
- Create: `frontend/src/pages/graphs/list/GraphListPage.tsx`
- Create: `frontend/src/pages/graphs/list/__tests__/GraphListPage.test.tsx`

**Step 1：实现**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listGraphs, createGraph } from '@/api/graphs';
import { useAuth } from '@/store/auth';

export function GraphListPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: graphs = [] } = useQuery({ queryKey: ['graphs'], queryFn: listGraphs });
  const createMut = useMutation({
    mutationFn: () => createGraph({ graph_name: '新建图谱', graph_type: 'course' }),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['graphs'] }); nav(`/graphs/${g.graph_id}/edit`); },
  });
  const canCreate = user?.role === 'admin' || user?.role === 'expert';
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex justify-between mb-4">
        <h1 className="text-2xl font-bold">图谱列表</h1>
        {canCreate && (
          <button onClick={() => createMut.mutate()} className="bg-blue-600 text-white px-4 py-2 rounded">
            新建图谱
          </button>
        )}
      </div>
      <table className="w-full bg-white rounded shadow">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-left">名称</th><th className="p-2">类型</th>
          <th className="p-2">节点数</th><th className="p-2">关系数</th><th className="p-2">操作</th>
        </tr></thead>
        <tbody>
          {graphs.map((g: any) => (
            <tr key={g.graph_id} className="border-t hover:bg-gray-50">
              <td className="p-2">{g.graph_name}</td>
              <td className="p-2 text-center">{g.graph_type}</td>
              <td className="p-2 text-center">{g.node_count}</td>
              <td className="p-2 text-center">{g.relation_count}</td>
              <td className="p-2 text-center">
                <button onClick={() => nav(`/graphs/${g.graph_id}/edit`)} className="text-blue-600">编辑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 2：Commit**

```powershell
git add frontend/src/pages/graphs/list
git commit -m "feat(agent-e): add graph list page with role-based create button"
```

---

## Task 4：AI 模板管理页（管理员）

**Files:**
- Create: `frontend/src/api/templates.ts`
- Create: `frontend/src/pages/admin/templates/TemplateManagerPage.tsx`
- Create: `frontend/src/pages/admin/templates/TemplateForm.tsx`

**Step 1：`api/templates.ts`**

```ts
import { api } from '@/lib/api';
export const listTemplates = () => api.get('/api/templates').then((r) => r.data);
export const createTemplate = (body: any) => api.post('/api/templates', body).then((r) => r.data);
export const updateTemplate = (id: string, body: any) => api.put(`/api/templates/${id}`, body).then((r) => r.data);
export const deleteTemplate = (id: string) => api.delete(`/api/templates/${id}`).then((r) => r.data);
```

**Step 2：`TemplateManagerPage.tsx`**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTemplates, deleteTemplate } from '@/api/templates';
import { TemplateForm } from './TemplateForm';

export function TemplateManagerPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: listTemplates });
  const delMut = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
  return (
    <div className="p-8">
      <div className="flex justify-between mb-4">
        <h1 className="text-2xl font-bold">提示词模板</h1>
        <button onClick={() => setEditing({})} className="bg-blue-600 text-white px-4 py-2 rounded">新建模板</button>
      </div>
      <table className="w-full bg-white rounded shadow">
        <thead className="bg-gray-50"><tr><th className="p-2 text-left">名称</th><th>变量</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {templates.map((t: any) => (
            <tr key={t.id} className="border-t">
              <td className="p-2">{t.name}</td>
              <td className="text-center">{t.variables?.length ?? 0}</td>
              <td className="text-center">{t.is_active ? '启用' : '停用'}</td>
              <td className="text-center space-x-2">
                <button onClick={() => setEditing(t)} className="text-blue-600">编辑</button>
                <button onClick={() => delMut.mutate(t.id)} className="text-red-600">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <TemplateForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
```

**Step 3：`TemplateForm.tsx`** 实现一个 Dialog，包含 name、description、variables（JSON 编辑器或动态表单）、system_prompt（textarea）、user_prompt_template（textarea）、output_schema（JSON 编辑器）字段。

**Step 4：Commit**

```powershell
git add frontend/src/api/templates.ts frontend/src/pages/admin/templates
git commit -m "feat(agent-e): add template manager page (admin)"
```

---

## Task 5：用户管理页（管理员）

**Files:**
- Create: `frontend/src/api/users.ts`
- Create: `frontend/src/pages/admin/users/UserManagerPage.tsx`
- Create: `frontend/src/pages/admin/users/__tests__/UserManagerPage.test.tsx`

**契约对齐**（Agent-A Task 9）：

- `GET /api/users` → `User[]`
- `POST /api/users` body：`{ username, email, password, role }` → `{ user_id, username, email, role, created_at }`
- `PUT /api/users/:id/role` body：`{ role }`
- `DELETE /api/users/:id` → `{ ok: true }`
- 409 时 `{ error, code: 'USERNAME_TAKEN' | 'CANNOT_DELETE_SELF' }`，前端按 `code` 提示

**Step 1：API 层**

```ts
// frontend/src/api/users.ts
import { http } from './http';
import type { User, UserRole } from '@mkg/shared';

export const usersApi = {
  list:        () => http.get<User[]>('/api/users'),
  create:      (body: { username: string; email: string; password: string; role: UserRole }) =>
                 http.post<{ user_id: string; username: string; email: string; role: UserRole; created_at: string }>('/api/users', body),
  updateRole:  (id: string, role: UserRole) => http.put<User>(`/api/users/${id}/role`, { role }),
  remove:      (id: string) => http.delete<{ ok: true }>(`/api/users/${id}`),
};
```

**Step 2：页面**

```tsx
// UserManagerPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message, Popconfirm } from 'antd';
import type { User, UserRole } from '@mkg/shared';
import { usersApi } from '../../../api/users';
import { useAuthStore } from '../../../stores/auth';

const ROLE_OPTIONS: UserRole[] = ['admin', 'expert', 'operator', 'viewer'];

export function UserManagerPage() {
  const me = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ username: string; email: string; password: string; role: UserRole }>();

  const refresh = async () => {
    setLoading(true);
    try { setRows(await usersApi.list()); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const onCreate = async () => {
    const v = await form.validateFields();
    try {
      await usersApi.create(v);
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      await refresh();
    } catch (e: any) {
      if (e.response?.data?.code === 'USERNAME_TAKEN') message.error('用户名已存在');
      else message.error(e.response?.data?.error ?? '创建失败');
    }
  };

  const onChangeRole = async (u: User, role: UserRole) => {
    try {
      await usersApi.updateRole(u.id, role);
      message.success('角色已更新');
      await refresh();
    } catch (e: any) {
      message.error(e.response?.data?.error ?? '更新失败');
    }
  };

  const onDelete = async (u: User) => {
    try {
      await usersApi.remove(u.id);
      message.success('已删除');
      await refresh();
    } catch (e: any) {
      if (e.response?.data?.code === 'CANNOT_DELETE_SELF') message.error('不能删除自己');
      else message.error(e.response?.data?.error ?? '删除失败');
    }
  };

  const columns = useMemo(
    () => [
      { title: '用户名', dataIndex: 'username' },
      { title: '邮箱',   dataIndex: 'email' },
      {
        title: '角色',
        dataIndex: 'role',
        render: (role: UserRole, u: User) =>
          u.id === me?.id ? (
            <Tag color="gold">{role}（你自己）</Tag>
          ) : (
            <Select<UserRole>
              size="small"
              value={role}
              style={{ width: 120 }}
              options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
              onChange={(v) => onChangeRole(u, v)}
            />
          ),
      },
      { title: '创建时间', dataIndex: 'created_at', render: (s: string) => new Date(s).toLocaleString() },
      {
        title: '操作',
        render: (_: unknown, u: User) =>
          u.id === me?.id ? null : (
            <Popconfirm title={`删除 ${u.username}？`} onConfirm={() => onDelete(u)}>
              <Button danger size="small">删除</Button>
            </Popconfirm>
          ),
      },
    ],
    [me?.id],
  );

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setOpen(true)}>新建用户</Button>
        <Button onClick={refresh}>刷新</Button>
      </Space>

      <Table<User> rowKey="id" loading={loading} dataSource={rows} columns={columns as any} pagination={false} />

      <Modal title="新建用户" open={open} onCancel={() => setOpen(false)} onOk={onCreate} okText="创建">
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} initialValue="viewer">
            <Select options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

**Step 3：测试（react-testing-library + MSW，用 Agent-D 已有 mock 中心）**

```tsx
// __tests__/UserManagerPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagerPage } from '../UserManagerPage';
import { usersApi } from '../../../../api/users';

vi.mock('../../../../api/users');
vi.mock('../../../../stores/auth', () => ({
  useAuthStore: (sel: any) => sel({ user: { id: 'u_self', username: 'admin', role: 'admin' } }),
}));

beforeEach(() => {
  (usersApi.list as any).mockResolvedValue([
    { id: 'u_self', username: 'admin',  email: 'a@x.com', role: 'admin',    created_at: '2026-01-01T00:00:00Z' },
    { id: 'u_2',    username: 'expert', email: 'e@x.com', role: 'expert',   created_at: '2026-01-01T00:00:00Z' },
  ]);
});

describe('UserManagerPage', () => {
  it('渲染列表 + 自己不可改角色 / 删除', async () => {
    render(<UserManagerPage />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByText('admin（你自己）')).toBeInTheDocument();
    expect(screen.queryAllByText('删除').length).toBe(1); // 只对 expert 行有
  });

  it('USERNAME_TAKEN 显示错误', async () => {
    (usersApi.create as any).mockRejectedValue({ response: { data: { code: 'USERNAME_TAKEN' } } });
    render(<UserManagerPage />);
    fireEvent.click(await screen.findByText('新建用户'));
    fireEvent.change(screen.getByLabelText('用户名'),  { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('邮箱'),    { target: { value: 'x@x.com' } });
    fireEvent.change(screen.getByLabelText('密码'),    { target: { value: 'pw123456' } });
    fireEvent.click(screen.getByText('创建'));
    await waitFor(() => expect(screen.getByText('用户名已存在')).toBeInTheDocument());
  });
});
```

**Step 4：Commit**

```powershell
git add frontend/src/api/users.ts frontend/src/pages/admin/users
git commit -m "feat(agent-e): admin user manager page with role/delete + 409 handling"
```

**DoD：**
- ✅ 列表 / 新建 / 改角色 / 删除四个操作可用
- ✅ 自己一行不展示「删除」与角色 `Select`
- ✅ 409 `USERNAME_TAKEN` / `CANNOT_DELETE_SELF` 有差异化文案
- ✅ 测试两条全过

---

## Task 6：系统配置页（LLM endpoint / key — MVP 只读）

**Files:**
- Create: `frontend/src/api/system.ts`
- Create: `frontend/src/pages/admin/settings/SettingsPage.tsx`

**契约（与 Agent-A Task 11 对齐）：** MVP 阶段 LLM 配置由后端 `.env` 维护，前端只读展示。路径统一 `/api/system/llm`。

**Step 1：`api/system.ts`**

```ts
import { api } from '@/lib/api';

export interface LLMSettings { base_url: string; model: string; api_key_set: boolean }

export async function getLLMSettings(): Promise<LLMSettings> {
  return (await api.get('/api/system/llm')).data;
}
```

**Step 2：`SettingsPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { getLLMSettings } from '@/api/system';

export function SettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['system-llm'], queryFn: getLLMSettings });
  if (isLoading) return <div className="p-6">加载中…</div>;
  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold mb-4">系统配置 · LLM</h1>
      <table className="w-full text-sm">
        <tbody>
          <tr><td className="py-2 text-gray-500 w-32">Base URL</td><td>{data?.base_url}</td></tr>
          <tr><td className="py-2 text-gray-500">Model</td><td>{data?.model}</td></tr>
          <tr><td className="py-2 text-gray-500">API Key</td><td>{data?.api_key_set ? '已配置' : <span className="text-red-500">未配置</span>}</td></tr>
        </tbody>
      </table>
      <p className="mt-4 text-xs text-gray-500">
        MVP 阶段 LLM 配置由 <code>.env</code> 维护，请联系运维同学修改后重启后端。
      </p>
    </div>
  );
}
```

**Step 3：Commit**

```powershell
git add frontend/src/api/system.ts frontend/src/pages/admin/settings
git commit -m "feat(agent-e): add llm settings readonly page"
```

---

## Task 7：AI 生成面板（编辑器底部）

**Files:**
- Create: `frontend/src/components/AIGeneratePanel/AIGeneratePanel.tsx`
- Create: `frontend/src/api/ai.ts`

**Step 1：`api/ai.ts`**

```ts
import { api } from '@/lib/api';
export const generate = (body: { template_id: string; variables: Record<string,string>; graph_id?: string }) =>
  api.post('/api/ai/generate', body).then((r) => r.data);
export const getJob = (jobId: string) => api.get(`/api/ai/jobs/${jobId}`).then((r) => r.data);
export const approveAll = (jobId: string) => api.post(`/api/ai/jobs/${jobId}/approve-all`).then((r) => r.data);
export const approveSome = (jobId: string, body: { node_ids: string[]; relation_ids: string[] }) =>
  api.post(`/api/ai/jobs/${jobId}/approve`, body).then((r) => r.data);
```

**Step 2：`AIGeneratePanel.tsx`**

- 顶部下拉选择模板（`/api/templates`）
- 根据所选模板的 `variables` 动态渲染表单字段（text / select / textarea）
- 点击"AI 生成图谱"调用 `generate`，得到 `job_id` 后用 React Query 轮询 `getJob(jobId)`，完成后将 candidate 节点合并到 store，并打开 `<ReviewPanel>`

```tsx
const submit = async (vars: Record<string,string>) => {
  const job = await generate({ template_id: tplId, variables: vars, graph_id: graphId });
  setJobId(job.job_id);
};
useQuery({
  queryKey: ['ai-job', jobId],
  enabled: !!jobId,
  refetchInterval: (q) => (q.state.data?.status === 'success' || q.state.data?.status === 'failed' ? false : 2000),
  queryFn: () => getJob(jobId!),
  onSuccess: (j) => {
    if (j.status === 'success') {
      // 把 j.nodes、j.relations 合并到 graph store（status='candidate'）
      // 触发 <ReviewPanel> 显示
    }
  },
});
```

**Step 3：Commit**

```powershell
git add frontend/src/api/ai.ts frontend/src/components/AIGeneratePanel
git commit -m "feat(agent-e): add ai generate panel with polling"
```

---

## Task 8：审核面板（设计文档 §6.3）

**Files:**
- Create: `frontend/src/components/ReviewPanel/ReviewPanel.tsx`
- Create: `frontend/src/components/ReviewPanel/__tests__/ReviewPanel.test.tsx`
- Modify: `frontend/src/api/ai.ts`（暴露 approveAll/approveSome/rejectAll）

**契约对齐**（Agent-C Task 6）：

- `POST /api/ai/jobs/:jobId/approve-all`        → `{ ok, nodes, relations }`
- `POST /api/ai/jobs/:jobId/approve` body `{ node_ids, relation_ids }` → 同上
- `POST /api/ai/jobs/:jobId/reject-all`         → 同上
- 409 `JOB_NOT_SUCCEEDED` → 友好提示「任务尚未成功，无法审核」

**Step 1：API 层**

```ts
// frontend/src/api/ai.ts （追加）
import { http } from './http';

export const aiApi = {
  approveAll:  (jobId: string) => http.post<{ ok: true; nodes: number; relations: number }>(`/api/ai/jobs/${jobId}/approve-all`),
  approveSome: (jobId: string, body: { node_ids: string[]; relation_ids: string[] }) =>
                 http.post<{ ok: true; nodes: number; relations: number }>(`/api/ai/jobs/${jobId}/approve`, body),
  rejectAll:   (jobId: string) => http.post<{ ok: true; nodes: number; relations: number }>(`/api/ai/jobs/${jobId}/reject-all`),
};
```

**Step 2：完整组件实现**

```tsx
// ReviewPanel.tsx
import { useMemo, useState } from 'react';
import { Drawer, Button, Space, Table, Radio, Tag, message, Popconfirm, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import type { Node, Relation } from '@mkg/shared';
import { aiApi } from '../../api/ai';
import { useGraphStore } from '../../stores/graph';

interface Props {
  open: boolean;
  jobId: string;
  candidates: { nodes: Node[]; relations: Relation[] };
  onClose: () => void;
}

type Mode = 'all' | 'pick' | 'reject';

export function ReviewPanel({ open, jobId, candidates, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('all');
  const [pickedNodes, setPickedNodes] = useState<string[]>([]);
  const [pickedRels,  setPickedRels]  = useState<string[]>([]);

  const updateStatus      = useGraphStore((s) => s.updateNodesStatus);
  const removeNodes       = useGraphStore((s) => s.removeNodes);
  const updateRelStatus   = useGraphStore((s) => s.updateRelationsStatus);
  const removeRelations   = useGraphStore((s) => s.removeRelations);

  const onApiError = (e: any) => {
    if (e.response?.data?.code === 'JOB_NOT_SUCCEEDED') {
      message.error('任务尚未成功，无法审核');
    } else {
      message.error(e.response?.data?.error ?? '操作失败');
    }
  };

  const approveAllMut = useMutation({
    mutationFn: () => aiApi.approveAll(jobId),
    onSuccess: () => {
      updateStatus(candidates.nodes.map((n) => n.node_id), 'approved');
      updateRelStatus(candidates.relations.map((r) => r.relation_id), 'approved');
      message.success(`已确认 ${candidates.nodes.length} 节点 / ${candidates.relations.length} 关系`);
      onClose();
    },
    onError: onApiError,
  });

  const approveSomeMut = useMutation({
    mutationFn: () => aiApi.approveSome(jobId, { node_ids: pickedNodes, relation_ids: pickedRels }),
    onSuccess: (resp) => {
      updateStatus(pickedNodes, 'approved');
      updateRelStatus(pickedRels, 'approved');
      removeNodes(candidates.nodes.filter((n) => !pickedNodes.includes(n.node_id)).map((n) => n.node_id));
      removeRelations(candidates.relations.filter((r) => !pickedRels.includes(r.relation_id)).map((r) => r.relation_id));
      message.success(`已确认 ${resp.nodes} 节点 / ${resp.relations} 关系，丢弃其余`);
      onClose();
    },
    onError: onApiError,
  });

  const rejectAllMut = useMutation({
    mutationFn: () => aiApi.rejectAll(jobId),
    onSuccess: () => {
      removeNodes(candidates.nodes.map((n) => n.node_id));
      removeRelations(candidates.relations.map((r) => r.relation_id));
      message.success('已全部丢弃');
      onClose();
    },
    onError: onApiError,
  });

  const nodeColumns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name' },
      { title: '类型', dataIndex: 'node_type', render: (t: string) => <Tag>{t}</Tag> },
      { title: '置信度', dataIndex: 'confidence', render: (v: number) => (v != null ? v.toFixed(2) : '—') },
    ],
    [],
  );
  const relColumns = useMemo(
    () => [
      { title: '关系类型',  dataIndex: 'relation_type', render: (t: string) => <Tag color="blue">{t}</Tag> },
      { title: '源',         dataIndex: 'source_id' },
      { title: '目标',       dataIndex: 'target_id' },
    ],
    [],
  );

  const submit = () => {
    if (mode === 'all')    return approveAllMut.mutate();
    if (mode === 'reject') return rejectAllMut.mutate();
    if (mode === 'pick' && pickedNodes.length + pickedRels.length === 0) {
      message.warning('请至少勾选一项');
      return;
    }
    approveSomeMut.mutate();
  };

  const submitting = approveAllMut.isPending || approveSomeMut.isPending || rejectAllMut.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Space>
          <span>AI 生成结果</span>
          <Typography.Text type="secondary">
            共 {candidates.nodes.length} 节点 / {candidates.relations.length} 关系
          </Typography.Text>
        </Space>
      }
      width={560}
      footer={
        <Space style={{ float: 'right' }}>
          <Button onClick={onClose}>取消</Button>
          {mode === 'reject' ? (
            <Popconfirm title="确认全部丢弃？此操作不可撤销" onConfirm={submit}>
              <Button danger loading={submitting}>提交</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" loading={submitting} onClick={submit}>
              {mode === 'all' ? '一键全部确认' : '确认所选'}
            </Button>
          )}
        </Space>
      }
    >
      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} style={{ marginBottom: 16 }}>
        <Radio.Button value="all">一键确认</Radio.Button>
        <Radio.Button value="pick">逐条审核</Radio.Button>
        <Radio.Button value="reject">全部丢弃</Radio.Button>
      </Radio.Group>

      <Typography.Title level={5}>节点</Typography.Title>
      <Table<Node>
        rowKey="node_id"
        size="small"
        dataSource={candidates.nodes}
        columns={nodeColumns as any}
        pagination={false}
        rowSelection={
          mode === 'pick'
            ? {
                selectedRowKeys: pickedNodes,
                onChange: (keys) => setPickedNodes(keys as string[]),
              }
            : undefined
        }
      />

      <Typography.Title level={5} style={{ marginTop: 16 }}>关系</Typography.Title>
      <Table<Relation>
        rowKey="relation_id"
        size="small"
        dataSource={candidates.relations}
        columns={relColumns as any}
        pagination={false}
        rowSelection={
          mode === 'pick'
            ? {
                selectedRowKeys: pickedRels,
                onChange: (keys) => setPickedRels(keys as string[]),
              }
            : undefined
        }
      />
    </Drawer>
  );
}
```

**Step 3：Store 增量方法**（在 Agent-D 的 `stores/graph.ts` 上加，本任务负责接口约定）

```ts
// frontend/src/stores/graph.ts 接口（如已存在则跳过）
interface GraphStoreActions {
  updateNodesStatus(ids: string[], status: 'approved' | 'rejected'): void;
  removeNodes(ids: string[]): void;
  updateRelationsStatus(ids: string[], status: 'approved' | 'rejected'): void;
  removeRelations(ids: string[]): void;
}
```

**Step 4：测试**

```tsx
// __tests__/ReviewPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewPanel } from '../ReviewPanel';
import { aiApi } from '../../../api/ai';

vi.mock('../../../api/ai');
vi.mock('../../../stores/graph', () => ({
  useGraphStore: (sel: any) => sel({
    updateNodesStatus:    vi.fn(),
    removeNodes:          vi.fn(),
    updateRelationsStatus: vi.fn(),
    removeRelations:      vi.fn(),
  }),
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const candidates = {
  nodes: [
    { node_id: 'KP_1', node_type: 'knowledge_point', name: '心率', status: 'candidate' } as any,
    { node_id: 'KP_2', node_type: 'knowledge_point', name: '血压', status: 'candidate' } as any,
  ],
  relations: [
    { relation_id: '10', source_id: 'KP_1', target_id: 'KP_2', relation_type: 'RELATED_TO', status: 'candidate' } as any,
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('ReviewPanel', () => {
  it('一键确认调用 approveAll', async () => {
    (aiApi.approveAll as any).mockResolvedValue({ ok: true, nodes: 2, relations: 1 });
    wrap(<ReviewPanel open jobId="job_x" candidates={candidates} onClose={() => {}} />);
    fireEvent.click(screen.getByText('一键全部确认'));
    await waitFor(() => expect(aiApi.approveAll).toHaveBeenCalledWith('job_x'));
  });

  it('逐条审核空选时弹警告', async () => {
    wrap(<ReviewPanel open jobId="job_x" candidates={candidates} onClose={() => {}} />);
    fireEvent.click(screen.getByText('逐条审核'));
    fireEvent.click(screen.getByText('确认所选'));
    expect(aiApi.approveSome).not.toHaveBeenCalled();
  });

  it('逐条审核选中后提交 ids', async () => {
    (aiApi.approveSome as any).mockResolvedValue({ ok: true, nodes: 1, relations: 0 });
    wrap(<ReviewPanel open jobId="job_x" candidates={candidates} onClose={() => {}} />);
    fireEvent.click(screen.getByText('逐条审核'));
    // 勾第一个节点 checkbox（antd Table 第一个 selection 列）
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[1]); // 0 是表头全选
    fireEvent.click(screen.getByText('确认所选'));
    await waitFor(() =>
      expect(aiApi.approveSome).toHaveBeenCalledWith('job_x', { node_ids: ['KP_1'], relation_ids: [] }),
    );
  });

  it('JOB_NOT_SUCCEEDED 友好提示', async () => {
    (aiApi.approveAll as any).mockRejectedValue({ response: { data: { code: 'JOB_NOT_SUCCEEDED' } } });
    wrap(<ReviewPanel open jobId="job_x" candidates={candidates} onClose={() => {}} />);
    fireEvent.click(screen.getByText('一键全部确认'));
    await waitFor(() => expect(screen.getByText('任务尚未成功，无法审核')).toBeInTheDocument());
  });
});
```

**Step 5：与画布联动**

- 审核通过 → 调 `updateNodesStatus(ids, 'approved')`，自定义节点组件根据 `status` 自动去掉虚线
- 审核驳回 → 调 `removeNodes(ids)` / `removeRelations(ids)` 从画布移除

**Step 6：Commit**

```powershell
git add frontend/src/components/ReviewPanel frontend/src/api/ai.ts
git commit -m "feat(agent-e): full review panel with all/pick/reject + tests"
```

**DoD：**
- ✅ 三种模式（一键 / 逐条 / 丢弃）的 mutation 与画布同步生效
- ✅ 测试 4 条全部通过
- ✅ 409 `JOB_NOT_SUCCEEDED` 文案可见

---

## Task 9：顶部导航与角色菜单

**Files:**
- Create: `frontend/src/components/AppLayout.tsx`

**Step 1：实现**

- 顶部 logo + 当前用户名 + 退出按钮
- 管理员角色多显示「模板」「用户」「系统设置」三个入口
- 把 `<AppLayout>` 包到所有受保护路由外层

**Step 2：Commit**

```powershell
git add frontend/src/components/AppLayout.tsx frontend/src/App.tsx
git commit -m "feat(agent-e): add app layout with role-based nav"
```

---

## Task 10：DoD 验证

**Step 1：本地端到端流程**

```
1. 浏览器访问 http://localhost:3000，自动跳 /login
2. admin/admin123 登录 → /graphs
3. 顶部能看到「模板」「用户」「设置」三个管理员入口
4. 切到内容运营账号登录后，三个入口消失，"新建图谱"按钮也消失
5. 进入图谱编辑器，底部 AI 生成面板能拉到模板列表
6. 选择模板填写变量 → 点击"AI 生成图谱" → loading → 出现审核面板
7. 点击"一键全部确认" → 候选节点变为已通过
```

**Step 2：合并 PR**

`[Agent-E] Auth + Admin pages + AI generate/review panels`

---

## Agent-E 完工标志

- [ ] 登录/退出流程完整，刷新后保持登录态
- [ ] 三角色对应的菜单与按钮可见性正确
- [ ] 模板/用户/系统设置三个管理页 CRUD 可用
- [ ] AI 生成面板能触发 job 并轮询结果
- [ ] 审核面板能完成全部确认 / 逐条确认两条路径
- [ ] 与 Agent-D 的 GraphEditor 在同一页面共存且交互顺畅
