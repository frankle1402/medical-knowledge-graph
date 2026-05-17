/**
 * Direct backend HTTP helpers for setting up state without going through the UI
 * (creates templates, fetches login tokens, etc.). Keeps E2E specs short.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

export async function login(username: string, password: string): Promise<{ token: string; userId: string; role: string }> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`login failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { token: string; user: { id: string; role: string } };
  return { token: json.token, userId: json.user.id, role: json.user.role };
}

interface CreateTemplateInput {
  name: string;
  description?: string;
}

export async function ensureTemplate(token: string, input: CreateTemplateInput): Promise<{ id: string; name: string }> {
  // List first; reuse if a template with this name already exists.
  const listRes = await fetch(`${API}/api/templates`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (listRes.ok) {
    const items = (await listRes.json()) as Array<{ id: string; name: string; is_active?: boolean }>;
    const found = items.find((t) => t.name === input.name && t.is_active !== false);
    if (found) return { id: found.id, name: found.name };
  }
  const body = {
    name: input.name,
    description: input.description ?? 'E2E auto-created template',
    variables: [
      {
        key: 'topic',
        label: '主题',
        type: 'text',
        required: true,
        placeholder: '请输入主题',
      },
    ],
    system_prompt: 'You are a medical knowledge graph generator. Output JSON only.',
    user_prompt_template: '请就 {{topic}} 生成知识图谱。',
  };
  const res = await fetch(`${API}/api/templates`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createTemplate failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { id: string; name: string };
  return { id: json.id, name: json.name };
}

interface CreateGraphInput {
  graph_name: string;
  graph_type?: 'course' | 'chapter' | 'subject' | 'custom';
}

export async function createGraph(token: string, input: CreateGraphInput): Promise<{ graph_id: string; graph_name: string }> {
  const res = await fetch(`${API}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ graph_type: 'course', ...input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createGraph failed (${res.status}): ${text}`);
  }
  return (await res.json()) as { graph_id: string; graph_name: string };
}

export async function deleteGraph(token: string, graphId: string): Promise<void> {
  const res = await fetch(`${API}/api/graphs/${encodeURIComponent(graphId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  // 404 is fine — graph already cleaned up.
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`deleteGraph failed (${res.status}): ${text}`);
  }
}

export async function listGraphs(token: string): Promise<Array<{ graph_id: string; graph_name: string }>> {
  const res = await fetch(`${API}/api/graphs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`listGraphs failed (${res.status}): ${text}`);
  }
  return (await res.json()) as Array<{ graph_id: string; graph_name: string }>;
}

export const api = { login, ensureTemplate, createGraph, deleteGraph, listGraphs };
