# Agent-D — 前端图谱编辑器实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-that.

**目标（Goal）:** 完成 `frontend` 工作区，实现图谱编辑器主界面（设计文档 §6.2），包括 React Flow 画布、节点拖拽与连线、节点属性面板（§6.4 颜色规范）、自动布局、保存到后端、加载已有图谱。

**架构（Architecture）:** Vite + React 18；Zustand 管全局图谱状态；React Query 拉/写后端；React Flow 11 渲染画布；自定义节点组件按 `node_type` 切色（见设计文档 §6.4）；属性面板用 React Hook Form + Zod resolver，schema 来自 `@mkg/shared`；通过 `dagre` 自动布局。

**技术栈:** React 18 · Vite 5 · TypeScript · React Flow 11 · Zustand · TanStack Query · React Hook Form · Tailwind CSS · shadcn/ui · dagre。

---

## 工作分支

`feature/agent-d-frontend-editor`

## 输出目录（仅本 Agent 可写）

- `frontend/package.json`、`frontend/index.html`、`frontend/vite.config.ts`、`frontend/tsconfig.json`
- `frontend/src/main.tsx`（App.tsx 由 Agent-E 拥有）
- `frontend/src/lib/`（api client、theme）
- `frontend/src/api/graphs.ts`、`frontend/src/api/nodes.ts`、`frontend/src/api/relations.ts`
- `frontend/src/components/GraphEditor/`
- `frontend/src/components/NodePanel/`
- `frontend/src/components/ui/`（shadcn 生成）
- `frontend/src/pages/graphs/edit/`
- `frontend/src/store/graph.ts`

## 关键依赖

- ✅ Agent-G 的 monorepo workspaces 已就绪
- ✅ Agent-F 的 `@mkg/shared` 类型已发布
- ✅ Agent-B 的 `/api/graphs/:id`、`/api/nodes`、`/api/relations` 联通（联调阶段）
- 🔄 在 Agent-B/A 未完成前，使用 MSW mock（Task 3）

---

## Task 1：Vite + React + Tailwind 骨架

**Files:**
- Create: `frontend/package.json`、`frontend/vite.config.ts`、`frontend/tsconfig.json`、`frontend/tailwind.config.ts`、`frontend/postcss.config.js`、`frontend/index.html`、`frontend/src/main.tsx`、`frontend/src/index.css`（**App.tsx 由 Agent-E 拥有**）

**Step 1：写 `frontend/package.json`**

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 3000",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 3000",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mkg/shared": "*",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router-dom": "6.26.2",
    "@tanstack/react-query": "5.59.0",
    "zustand": "4.5.5",
    "reactflow": "11.11.4",
    "dagre": "0.8.5",
    "react-hook-form": "7.53.0",
    "@hookform/resolvers": "3.9.0",
    "zod": "3.23.8",
    "axios": "1.7.7",
    "clsx": "2.1.1",
    "tailwind-merge": "2.5.2",
    "lucide-react": "0.445.0"
  },
  "devDependencies": {
    "@types/react": "18.3.7",
    "@types/react-dom": "18.3.0",
    "@types/dagre": "0.7.52",
    "@vitejs/plugin-react": "4.3.1",
    "vite": "5.4.7",
    "vitest": "2.0.5",
    "@testing-library/react": "16.0.1",
    "@testing-library/jest-dom": "6.5.0",
    "@testing-library/user-event": "14.5.2",
    "jsdom": "25.0.0",
    "msw": "2.4.9",
    "tailwindcss": "3.4.13",
    "postcss": "8.4.47",
    "autoprefixer": "10.4.20",
    "typescript": "5.5.4"
  }
}
```

**Step 2：`frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:4000' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
```

**Step 3：`frontend/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

**Step 4：`frontend/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        node: {
          knowledge_point: '#3B82F6',
          term: '#10B981',
          operation_step: '#F59E0B',
          competency: '#8B5CF6',
          image: '#EC4899',
          table: '#06B6D4',
          question: '#EF4444',
          case: '#92400E',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

**Step 5：完整骨架文件**

`frontend/postcss.config.js`：

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`frontend/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>医学知识图谱平台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/index.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
.btn { @apply px-3 py-1.5 rounded border text-sm hover:bg-gray-50; }
.btn-primary { @apply px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700; }
```

`frontend/src/main.tsx`：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'reactflow/dist/style.css';
import './index.css';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

async function bootstrap() {
  if (import.meta.env.VITE_USE_MOCK === '1') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
  // App.tsx 由 Agent-E 维护，路由表与 RequireRole 守卫均在此
  const { App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
```

> 注：`App.tsx` 完整路由表由 Agent-E Task 2 实现；本 Agent 仅约定其导出形式为 `export function App()`。

**Step 6：装包 + 启动验证**

```powershell
npm install
npm -w frontend run dev
```

Expected：浏览器打开 `http://localhost:3000` 显示空白 React 页面。

**Step 7：Commit**

```powershell
git add frontend package.json package-lock.json
git commit -m "chore(agent-d): bootstrap frontend workspace"
```

---

## Task 2：API client + axios 拦截器

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/__tests__/api.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { api, setToken } from '../api';

describe('api client', () => {
  it('setToken 后请求带 Authorization 头', async () => {
    setToken('jwt-x');
    const config = { headers: {} as any };
    const interceptor = api.interceptors.request as any;
    const handler = interceptor.handlers[0]?.fulfilled;
    const out = await handler({ headers: {} });
    expect(out.headers.Authorization).toBe('Bearer jwt-x');
  });
});
```

**Step 2：实现 `lib/api.ts`**

```ts
import axios from 'axios';

let token: string | null = localStorage.getItem('jwt');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('jwt', t);
  else localStorage.removeItem('jwt');
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/',
  timeout: 30_000,
});

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      setToken(null);
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
```

**Step 3：Commit**

```powershell
git add frontend/src/lib
git commit -m "feat(agent-d): add api client with jwt interceptor"
```

---

## Task 3：MSW mock 后端（开发期解耦）

**Files:**
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/mocks/handlers.ts`
- Create: `frontend/src/mocks/browser.ts`

**Step 1：实现 `mocks/handlers.ts`**

```ts
import { http, HttpResponse } from 'msw';

const fakeGraph = {
  graph_id: 'graph_demo',
  graph_name: '示例图谱',
  nodes: [],
  relations: [],
};

export const handlers = [
  http.post('/api/auth/login', () =>
    HttpResponse.json({ token: 'fake-jwt', user: { id: 'u1', username: 'admin', role: 'admin' } }),
  ),
  http.get('/api/graphs', () => HttpResponse.json([fakeGraph])),
  http.get('/api/graphs/:id', () => HttpResponse.json(fakeGraph)),
];
```

**Step 2：`mocks/browser.ts`**

```ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
export const worker = setupWorker(...handlers);
```

**Step 3：在 `main.tsx` 按 env 启用**

```ts
if (import.meta.env.VITE_USE_MOCK === '1') {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

**Step 4：Commit**

```powershell
git add frontend/src/mocks frontend/src/main.tsx
git commit -m "feat(agent-d): add msw mock for offline frontend dev"
```

---

## Task 4：Zustand 图谱 store

**Files:**
- Create: `frontend/src/store/graph.ts`
- Create: `frontend/src/store/__tests__/graph.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { useGraphStore } from '../graph';

describe('graph store', () => {
  it('addNode 后 nodes 长度 +1', () => {
    useGraphStore.getState().reset();
    useGraphStore.getState().addNode({
      node_id: 'n1', node_type: 'knowledge_point', name: 'x', status: 'approved', source: 'manual',
    } as any);
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });
  it('removeNode 同时移除相关 relations', () => {
    const s = useGraphStore.getState();
    s.reset();
    s.addNode({ node_id: 'a', node_type: 'knowledge_point', name: 'a' } as any);
    s.addNode({ node_id: 'b', node_type: 'knowledge_point', name: 'b' } as any);
    s.addRelation({ source_id: 'a', target_id: 'b', relation_type: 'RELATED_TO' } as any);
    s.removeNode('a');
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().relations).toHaveLength(0);
  });
});
```

**Step 2：实现 `store/graph.ts`**

```ts
import { create } from 'zustand';
import type { Node, Relation } from '@mkg/shared';

interface GraphState {
  graphId: string | null;
  nodes: Node[];
  relations: Relation[];
  selectedNodeId: string | null;
  setGraph: (id: string, nodes: Node[], relations: Relation[]) => void;
  addNode: (n: Node) => void;
  updateNode: (id: string, patch: Partial<Node>) => void;
  removeNode: (id: string) => void;
  addRelation: (r: Relation) => void;
  removeRelation: (sourceId: string, targetId: string, type: string) => void;
  selectNode: (id: string | null) => void;
  reset: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  graphId: null,
  nodes: [],
  relations: [],
  selectedNodeId: null,
  setGraph: (id, nodes, relations) => set({ graphId: id, nodes, relations }),
  addNode: (n) => set((s) => ({ nodes: [...s.nodes, n] })),
  updateNode: (id, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.node_id === id ? { ...n, ...patch } : n)) })),
  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.node_id !== id),
      relations: s.relations.filter((r) => r.source_id !== id && r.target_id !== id),
    })),
  addRelation: (r) => set((s) => ({ relations: [...s.relations, r] })),
  removeRelation: (sourceId, targetId, type) =>
    set((s) => ({
      relations: s.relations.filter(
        (r) => !(r.source_id === sourceId && r.target_id === targetId && r.relation_type === type),
      ),
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  reset: () => set({ graphId: null, nodes: [], relations: [], selectedNodeId: null }),
}));
```

**Step 3：测试通过 + Commit**

```powershell
git add frontend/src/store
git commit -m "feat(agent-d): add zustand graph store"
```

---

## Task 5：自定义节点组件（按 node_type 配色）

**Files:**
- Create: `frontend/src/components/GraphEditor/CustomNode.tsx`
- Create: `frontend/src/components/GraphEditor/nodeColors.ts`

**Step 1：`nodeColors.ts`（对应设计文档 §6.4）**

```ts
import type { NodeType } from '@mkg/shared';

export const NODE_COLORS: Record<NodeType, string> = {
  knowledge_point: '#3B82F6',
  term: '#10B981',
  operation_step: '#F59E0B',
  competency: '#8B5CF6',
  image: '#EC4899',
  table: '#06B6D4',
  question: '#EF4444',
  case: '#92400E',
  textbook: '#1E40AF',
  chapter: '#1E40AF',
  section: '#1E40AF',
};

export const CANDIDATE_BORDER = '2px dashed #9CA3AF';
```

**Step 2：`CustomNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from 'reactflow';
import { NODE_COLORS, CANDIDATE_BORDER } from './nodeColors';
import type { Node as KGNode } from '@mkg/shared';

export function CustomNode({ data, selected }: NodeProps<KGNode>) {
  const color = NODE_COLORS[data.node_type];
  const isCandidate = data.status === 'candidate';
  return (
    <div
      className="rounded-lg px-3 py-2 text-white shadow-md min-w-[140px] text-sm"
      style={{
        background: color,
        border: isCandidate ? CANDIDATE_BORDER : selected ? '2px solid #fff' : '1px solid transparent',
        opacity: isCandidate ? 0.85 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold truncate">{data.name}</div>
      <div className="text-[10px] opacity-80">{data.node_type}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

**Step 3：Commit**

```powershell
git add frontend/src/components/GraphEditor/CustomNode.tsx frontend/src/components/GraphEditor/nodeColors.ts
git commit -m "feat(agent-d): add custom node component with type colors"
```

---

## Task 6：GraphCanvas 主画布

**Files:**
- Create: `frontend/src/components/GraphEditor/GraphCanvas.tsx`
- Create: `frontend/src/components/GraphEditor/layout.ts`

**Step 1：`layout.ts`（dagre 自动布局）**

```ts
import dagre from 'dagre';
import type { Node as RFNode, Edge as RFEdge } from 'reactflow';

export function autoLayout(nodes: RFNode[], edges: RFEdge[]): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });
  nodes.forEach((n) => g.setNode(n.id, { width: 160, height: 60 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - 80, y: p.y - 30 } };
  });
}
```

**Step 2：`GraphCanvas.tsx`**

```tsx
import { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap, type Edge, type Node as RFNode,
  addEdge, useEdgesState, useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphStore } from '@/store/graph';
import { CustomNode } from './CustomNode';
import { autoLayout } from './layout';

const nodeTypes = { kgNode: CustomNode };

export function GraphCanvas() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeRelations = useGraphStore((s) => s.relations);
  const selectNode = useGraphStore((s) => s.selectNode);
  const addRelation = useGraphStore((s) => s.addRelation);

  const initialNodes = useMemo<RFNode[]>(
    () => storeNodes.map((n) => ({
      id: n.node_id, type: 'kgNode', position: { x: 0, y: 0 }, data: n,
    })),
    [storeNodes],
  );
  const initialEdges = useMemo<Edge[]>(
    () => storeRelations.map((r, i) => ({
      id: `e_${i}_${r.source_id}_${r.target_id}`,
      source: r.source_id, target: r.target_id, label: r.relation_type,
    })),
    [storeRelations],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(autoLayout(initialNodes, initialEdges));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback((c: any) => {
    // 弹 picker 让用户选 relation_type，picker 由 RelationTypePicker 组件提供
    document.dispatchEvent(new CustomEvent('open-relation-type-picker', {
      detail: { source: c.source, target: c.target },
    }));
  }, []);

  return (
    <ReactFlow
      nodes={nodes} edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, n) => selectNode(n.id)}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('open-canvas-context-menu', {
          detail: { x: e.clientX, y: e.clientY, type: 'pane' },
        }));
      }}
      onNodeContextMenu={(e, n) => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('open-canvas-context-menu', {
          detail: { x: e.clientX, y: e.clientY, type: 'node', nodeId: n.id },
        }));
      }}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
      <FloatingControls />
    </ReactFlow>
  );
}

function FloatingControls() {
  const { setViewport, getViewport } = useReactFlow();
  const onRelayout = () => {
    const ns = useGraphStore.getState().nodes;
    const rs = useGraphStore.getState().relations;
    const rfNodes = ns.map((n) => ({ id: n.node_id, type: 'kgNode', position: { x: 0, y: 0 }, data: n }));
    const rfEdges = rs.map((r, i) => ({ id: `e_${i}`, source: r.source_id, target: r.target_id }));
    autoLayout(rfNodes, rfEdges); // 内部已 mutate position
  };
  const onFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };
  return (
    <div className="absolute top-2 right-2 z-10 flex gap-1">
      <button className="btn" onClick={onRelayout}>布局重排</button>
      <button className="btn" onClick={onFullscreen}>全屏</button>
    </div>
  );
}
```

> 需要在文件顶部 `import` 中加入 `useReactFlow`：`import ReactFlow, { ..., useReactFlow } from 'reactflow';`

**Step 3：Commit**

```powershell
git add frontend/src/components/GraphEditor
git commit -m "feat(agent-d): add graph canvas + context menu + relayout/fullscreen"
```

---

## Task 6.5：右键菜单 ContextMenu + RelationTypePicker

**Files:**
- Create: `frontend/src/components/GraphEditor/CanvasContextMenu.tsx`
- Create: `frontend/src/components/GraphEditor/RelationTypePicker.tsx`

**Step 1：`CanvasContextMenu.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useGraphStore } from '@/store/graph';
import { useAuth } from '@/store/auth';
import { createNode, deleteNode } from '@/api/nodes';
import { useParams } from 'react-router-dom';

type Detail = { x: number; y: number; type: 'pane' | 'node'; nodeId?: string };

export function CanvasContextMenu() {
  const [detail, setDetail] = useState<Detail | null>(null);
  const { id: graphId = '' } = useParams();
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'expert';
  const addNode = useGraphStore((s) => s.addNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const selectNode = useGraphStore((s) => s.selectNode);

  useEffect(() => {
    const open = (e: CustomEvent<Detail>) => setDetail(e.detail);
    const close = () => setDetail(null);
    document.addEventListener('open-canvas-context-menu', open as EventListener);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('open-canvas-context-menu', open as EventListener);
      document.removeEventListener('click', close);
    };
  }, []);

  if (!detail || !canEdit) return null;

  const items: Array<{ label: string; onClick: () => void } | null> =
    detail.type === 'pane'
      ? [
          {
            label: '添加节点',
            onClick: async () => {
              const n = await createNode(graphId, {
                node_type: 'knowledge_point',
                name: '新节点',
                knowledge_type: '概念类',
                difficulty: '了解',
                importance: '一般',
              } as any);
              addNode(n);
              selectNode(n.node_id);
              setDetail(null);
            },
          },
        ]
      : [
          { label: '编辑属性', onClick: () => { selectNode(detail.nodeId!); setDetail(null); } },
          {
            label: '连接到...',
            onClick: () => {
              document.dispatchEvent(new CustomEvent('start-connect', { detail: { source: detail.nodeId } }));
              setDetail(null);
            },
          },
          {
            label: '删除节点',
            onClick: async () => {
              await deleteNode(detail.nodeId!);
              removeNode(detail.nodeId!);
              setDetail(null);
            },
          },
        ];

  return (
    <ul
      className="fixed z-50 bg-white border rounded shadow text-sm min-w-[140px]"
      role="menu"
      style={{ top: detail.y, left: detail.x }}
    >
      {items.map((it, i) => it && (
        <li key={i}>
          <button role="menuitem" className="w-full text-left px-3 py-1.5 hover:bg-gray-100" onClick={it.onClick}>
            {it.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

**Step 2：`RelationTypePicker.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { RelationType } from '@mkg/shared';
import { useParams } from 'react-router-dom';
import { createRelation } from '@/api/relations';
import { useGraphStore } from '@/store/graph';

const TYPES = RelationType.options.filter((t) => t !== 'BELONGS_TO_GRAPH');

export function RelationTypePicker() {
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null);
  const { id: graphId = '' } = useParams();
  const addRelation = useGraphStore((s) => s.addRelation);

  useEffect(() => {
    const open = (e: CustomEvent<{ source: string; target: string }>) => setPending(e.detail);
    document.addEventListener('open-relation-type-picker', open as EventListener);
    return () => document.removeEventListener('open-relation-type-picker', open as EventListener);
  }, []);

  if (!pending) return null;
  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50" onClick={() => setPending(null)}>
      <div className="bg-white rounded shadow p-4 w-[320px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-3">选择关系类型</h3>
        <ul className="grid grid-cols-2 gap-1">
          {TYPES.map((t) => (
            <li key={t}>
              <button
                className="btn w-full"
                onClick={async () => {
                  const r = await createRelation(graphId, {
                    source_id: pending.source,
                    target_id: pending.target,
                    relation_type: t,
                  });
                  addRelation(r);
                  setPending(null);
                }}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

**Step 3：在 `GraphEditorPage` 挂载两个组件**

在 `<main>` 内 GraphCanvas 之后追加 `<CanvasContextMenu /> <RelationTypePicker />`。

**Step 4：Commit**

```powershell
git add frontend/src/components/GraphEditor
git commit -m "feat(agent-d): context menu + relation type picker"
```

---

## Task 7：右侧节点属性面板（NodePanel）

**Files:**
- Create: `frontend/src/components/NodePanel/NodePanel.tsx`
- Create: `frontend/src/components/NodePanel/forms/KnowledgePointForm.tsx`
- Create: `frontend/src/components/NodePanel/forms/TermForm.tsx`

**Step 1：`NodePanel.tsx`（动态分发）**

```tsx
import { useGraphStore } from '@/store/graph';
import { KnowledgePointForm } from './forms/KnowledgePointForm';
import { TermForm } from './forms/TermForm';

export function NodePanel() {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) => s.nodes.find((n) => n.node_id === selectedId));
  if (!node) return <div className="p-4 text-gray-400">请选择一个节点</div>;
  switch (node.node_type) {
    case 'knowledge_point': return <KnowledgePointForm node={node} />;
    case 'term': return <TermForm node={node} />;
    default: return <pre className="p-4 text-xs">{JSON.stringify(node, null, 2)}</pre>;
  }
}
```

**Step 2：`KnowledgePointForm.tsx`（用 react-hook-form + Zod）**

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KnowledgePointNode, KnowledgeType, Difficulty, Importance } from '@mkg/shared';
import { useGraphStore } from '@/store/graph';

export function KnowledgePointForm({ node }: { node: any }) {
  const update = useGraphStore((s) => s.updateNode);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(KnowledgePointNode),
    defaultValues: node,
  });
  const onSubmit = (data: any) => update(node.node_id, data);
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
      <Field label="名称"><input {...register('name')} className="input" /></Field>
      <Field label="知识类型">
        <select {...register('knowledge_type')} className="input">
          {KnowledgeType.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="难度">
        <select {...register('difficulty')} className="input">
          {Difficulty.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="重要性">
        <select {...register('importance')} className="input">
          {Importance.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="描述"><textarea {...register('description')} className="input" rows={4} /></Field>
      <button className="btn-primary" disabled={!formState.isDirty}>保存</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-gray-500">{label}</span>{children}</label>;
}
```

**Step 3：Commit**

```powershell
git add frontend/src/components/NodePanel
git commit -m "feat(agent-d): add node property panel with dynamic forms"
```

---

## Task 8：编辑器主页面 `/graphs/:id/edit`

**Files:**
- Create: `frontend/src/pages/graphs/edit/index.tsx`
- Create: `frontend/src/api/graphs.ts`
- Create: `frontend/src/api/nodes.ts`
- Create: `frontend/src/api/relations.ts`

> **拥有权调整**：`frontend/src/App.tsx` 由 Agent-E 拥有（路由聚合页）。本 Task 仅导出 `GraphEditorPage` 命名导出，不修改 App.tsx。

**Step 1：`api/graphs.ts`（响应形态与 Agent-B Task 5 对齐）**

```ts
import { api } from '@/lib/api';
import type { Graph, Node, Relation } from '@mkg/shared';

export interface GraphDetail {
  graph: Graph & { node_count: number; relation_count: number };
  nodes: Node[];
  relations: Relation[];
}

export async function fetchGraph(id: string): Promise<GraphDetail> {
  return (await api.get(`/api/graphs/${id}`)).data;
}

// 仅修改图谱元信息（graph_name / description / subject 等）
export async function updateGraphMeta(id: string, patch: Partial<Graph>) {
  return (await api.put(`/api/graphs/${id}`, patch)).data;
}

// 触发后端 export 并触发浏览器下载
export async function exportGraph(id: string) {
  const res = await api.post(`/api/graphs/${id}/export`, {}, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `graph-${id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Step 2：`api/nodes.ts` / `api/relations.ts`（编辑器单点保存依赖）**

```ts
// api/nodes.ts
import { api } from '@/lib/api';
import type { Node } from '@mkg/shared';

export const createNode = (graphId: string, n: Partial<Node>) =>
  api.post(`/api/graphs/${graphId}/nodes`, n).then((r) => r.data);
export const updateNode = (nodeId: string, patch: Partial<Node>) =>
  api.put(`/api/nodes/${nodeId}`, patch).then((r) => r.data);
export const deleteNode = (nodeId: string) =>
  api.delete(`/api/nodes/${nodeId}`).then((r) => r.data);
```

```ts
// api/relations.ts
import { api } from '@/lib/api';
import type { Relation } from '@mkg/shared';

export const createRelation = (graphId: string, r: Partial<Relation>) =>
  api.post(`/api/graphs/${graphId}/relations`, r).then((res) => res.data);
export const deleteRelation = (relationId: string) =>
  api.delete(`/api/relations/${relationId}`).then((r) => r.data);
```

**Step 3：编辑器页面（三栏布局，对应设计文档 §6.2）**

```tsx
// frontend/src/pages/graphs/edit/GraphEditorPage.tsx
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraphCanvas } from '@/components/GraphEditor/GraphCanvas';
import { GraphTopBar } from '@/components/GraphEditor/GraphTopBar';
import { GraphSidebar } from '@/components/GraphEditor/GraphSidebar';
import { CanvasContextMenu } from '@/components/GraphEditor/CanvasContextMenu';
import { RelationTypePicker } from '@/components/GraphEditor/RelationTypePicker';
import { NodePanel } from '@/components/NodePanel/NodePanel';
import { useGraphStore } from '@/store/graph';
import { fetchGraph } from '@/api/graphs';

export function GraphEditorPage() {
  const { id = '' } = useParams();
  const setGraph = useGraphStore((s) => s.setGraph);
  const { data, isLoading } = useQuery({ queryKey: ['graph', id], queryFn: () => fetchGraph(id) });

  useEffect(() => {
    if (data) setGraph(data.graph.graph_id, data.nodes, data.relations);
  }, [data, setGraph]);

  if (isLoading) return <div className="p-8">加载中...</div>;
  return (
    <div className="grid grid-cols-[240px_1fr_320px] grid-rows-[48px_1fr_120px] h-screen">
      <GraphTopBar graph={data?.graph} />
      <GraphSidebar />
      <main className="relative">
        <GraphCanvas />
        <CanvasContextMenu />
        <RelationTypePicker />
      </main>
      <aside className="border-l overflow-auto"><NodePanel /></aside>
      <footer className="col-span-3 border-t p-3" id="ai-generate-slot">
        {/* Agent-E 在此挂载 AIGeneratePanel */}
      </footer>
    </div>
  );
}
```

> 顶部 / 左侧组件分别在 Task 8a / 8b 实现。

**Step 4：`saveGraph` 改为按变更集分发（增量保存语义）**

每次画布操作直接调对应 API：

| 用户动作 | API 调用 |
|---|---|
| 拖动右键菜单"添加节点"完成表单 | `createNode(graphId, payload)` → store.addNode |
| NodePanel 表单提交 | `updateNode(node_id, patch)` → store.updateNode |
| 右键菜单"删除节点" | `deleteNode(node_id)` → store.removeNode |
| 拖拽连线 + 选 relation_type | `createRelation(graphId, {source_id,target_id,relation_type})` → store.addRelation |
| 删除关系 | `deleteRelation(relation_id)` → store.removeRelation |
| 顶部"图谱设置"对话框提交 | `updateGraphMeta(id, {graph_name, description})` |

**Step 5：Commit**

```powershell
git add frontend/src/pages/graphs/edit frontend/src/api
git commit -m "feat(agent-d): graph editor page + per-entity save apis"
```

---

## Task 8a：顶部工具栏 `GraphTopBar`

**Files:** Create `frontend/src/components/GraphEditor/GraphTopBar.tsx`

```tsx
import { useNavigate } from 'react-router-dom';
import { exportGraph } from '@/api/graphs';
import { useAuth } from '@/store/auth';
import type { Graph } from '@mkg/shared';

export function GraphTopBar({ graph }: { graph?: Graph }) {
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'expert';
  return (
    <header className="col-span-3 flex items-center justify-between border-b px-4 bg-white">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/graphs')} className="text-sm text-gray-500 hover:text-black">‹ 返回</button>
        <div className="font-semibold">{graph?.graph_name}</div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => graph && exportGraph(graph.graph_id)}>导出 JSON</button>
        {canEdit && <button className="btn" onClick={() => document.dispatchEvent(new Event('open-graph-settings'))}>图谱设置</button>}
        <UserAvatar />
      </div>
    </header>
  );
}

function UserAvatar() {
  const user = useAuth((s) => s.user);
  return <div className="w-8 h-8 rounded-full bg-blue-500 text-white grid place-items-center text-xs">{user?.username?.[0]?.toUpperCase()}</div>;
}
```

```powershell
git add frontend/src/components/GraphEditor/GraphTopBar.tsx
git commit -m "feat(agent-d): top toolbar with export + settings + avatar"
```

---

## Task 8b：左侧 `GraphSidebar`（图谱切换 + 节点类型图例）

**Files:** Create `frontend/src/components/GraphEditor/GraphSidebar.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { NODE_COLORS } from './nodeColors';

export function GraphSidebar() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: list = [] } = useQuery({ queryKey: ['graphs'], queryFn: () => api.get('/api/graphs').then((r) => r.data) });
  return (
    <aside className="border-r overflow-y-auto p-3 space-y-4 text-sm">
      <section>
        <div className="font-semibold mb-2">图谱列表</div>
        <ul className="space-y-1">
          {list.map((g: any) => (
            <li key={g.graph_id}>
              <button
                className={`w-full text-left px-2 py-1 rounded ${g.graph_id === id ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                onClick={() => navigate(`/graphs/${g.graph_id}/edit`)}
              >{g.graph_name}</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="font-semibold mb-2">节点类型图例</div>
        <ul className="space-y-1">
          {Object.entries(NODE_COLORS).map(([t, color]) => (
            <li key={t} className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded" style={{ background: color }} />
              <span className="text-xs">{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
```

```powershell
git add frontend/src/components/GraphEditor/GraphSidebar.tsx
git commit -m "feat(agent-d): left sidebar with graph switcher + legend"
```

---

## Task 9：候选节点（AI 待审核）的渲染

**Files:**
- Modify: `frontend/src/components/GraphEditor/CustomNode.tsx`（已支持 status === 'candidate'，仅需补 hover tip）
- Create: `frontend/src/components/GraphEditor/CandidateBadge.tsx`

**Step 1：`CandidateBadge.tsx`**

```tsx
export function CandidateBadge({ confidence }: { confidence?: number }) {
  return (
    <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
      待审核 {confidence ? Math.round(confidence * 100) + '%' : ''}
    </span>
  );
}
```

**Step 2：在 `CustomNode` 中条件渲染**

```tsx
{isCandidate && <CandidateBadge confidence={data.confidence} />}
```

**Step 3：Commit**

```powershell
git add frontend/src/components/GraphEditor
git commit -m "feat(agent-d): show candidate badge on AI-generated nodes"
```

---

## Task 10：性能优化（1000 节点）

**Files:**
- Modify: `frontend/src/components/GraphEditor/GraphCanvas.tsx`

**Step 1：启用 React Flow 的 `onlyRenderVisibleElements`**

```tsx
<ReactFlow ... onlyRenderVisibleElements />
```

**Step 2：`autoLayout` 缓存（用 nodes/edges 的长度做 key）**

避免每次 store 变更都重算布局，仅在节点数变更时触发。

**Step 3：手工压测**

在浏览器 console 执行：

```js
const s = window.__store__;
for (let i = 0; i < 1000; i++) {
  s.getState().addNode({ node_id: 'x' + i, node_type: 'knowledge_point', name: 'n' + i });
}
```

验证 FPS（DevTools Performance）≥ 30。

**Step 4：Commit**

```powershell
git commit -am "perf(agent-d): enable virtualization for large graphs"
```

---

## Task 11：DoD 验证

**Step 1：本地端到端**

```powershell
npm run dev   # 同时启动前后端
# 浏览器打开 http://localhost:3000/graphs/<某id>/edit
```

验证：

- 三栏布局显示正确
- 节点按颜色规范显示
- 拖动节点位置可改变
- 连线创建关系
- 选中节点后右侧表单同步显示
- 编辑后点击「保存」，刷新页面仍存在

**Step 2：合并 PR**

`[Agent-D] Graph editor MVP (canvas + panel + save/load)`

---

## Agent-D 完工标志

- [ ] `/graphs/:id/edit` 页面可加载并显示图谱
- [ ] 节点按 8 种颜色显示（设计文档 §6.4）
- [ ] 候选节点带"待审核"角标
- [ ] 拖拽与连线产生 store 变更
- [ ] 保存按钮调 `PUT /api/graphs/:id` 持久化
- [ ] 1000 节点压测 FPS ≥ 30
...[truncated 9899 chars]