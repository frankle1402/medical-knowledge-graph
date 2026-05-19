# Pack C — RAG 语义检索（pgvector + OpenAI embeddings）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 在 PG 后端基础上引入 OpenAI text-embedding-3-small（1536 维），节点 upsert 时同步写 embedding，提供 `POST /api/graphs/:id/search` 自然语言查询返回 top-k 相似节点 + 1 跳邻居。

**Architecture:** Embedding 调用走异步队列（写入路径不卡 user request）；search 路由用 `<=>` cosine 距离 ORDER BY 取 top-k；批量回填脚本支持 resume；测试 mock OpenAI 客户端。

**Tech Stack:** OpenAI Node SDK · pgvector · Prisma raw query · vitest + msw（mock HTTP）

---

## 工作分支

`feature/pg-migration-pack-c-rag`

## 输出目录（仅本 Pack 可写）

- `backend/src/services/embedding/openai.ts`（**新增**）
- `backend/src/services/embedding/__tests__/openai.test.ts`
- `backend/src/services/embedding/queue.ts`（异步队列，可选简单版）
- `backend/src/modules/search/search.service.ts`
- `backend/src/modules/search/search.routes.ts`
- `backend/src/modules/search/__tests__/search.service.test.ts`
- `backend/src/scripts/backfill-embeddings.ts`
- `backend/src/scripts/__tests__/backfill-embeddings.test.ts`
- `backend/src/index.ts`（mount search.routes — 这一处对外接口）

## 边界（不可动）

- `backend/src/modules/{graphs,nodes,relations}/`（Pack B 范围）
- `backend/src/modules/learning/`（Pack D 范围）
- 前端代码（Pack E 范围）
- Prisma schema（Pack A 已定）

## 关键依赖

- ✅ Pack A（embedding 列 + ivfflat 索引已就绪）
- ✅ Pack B（NodeService 已走 PG，**这点很重要 — 嵌入要 hook 进 PG 路径**）
- 需新装 `openai` npm 包

---

## API 契约（前端 Pack E 依赖此契约）

### POST /api/graphs/:graph_id/search

**Request:**
```json
{ "q": "心率波动异常", "k": 10, "include_neighbors": true }
```
- `q`: string, required, 1-500 chars
- `k`: int, optional, default 10, max 50
- `include_neighbors`: bool, optional, default true

**Response 200:**
```json
{
  "matches": [
    {
      "node": { "node_id": "KP_001", "name": "心率失常", "node_type": "knowledge_point", ... },
      "score": 0.93,
      "neighbors": [
        { "node_id": "KP_002", "name": "心动过速", ... }
      ]
    }
  ]
}
```
- `score`: 1 - cosine_distance（越大越相似）
- 若 `include_neighbors=false`，省略该字段

**错误**：
- 400：q 为空 / k 超限
- 401：未登录
- 404：graph 不存在
- 503：OpenAI API 暂时不可达（带 Retry-After）

---

## Task 1：OpenAI embedding service

**Files:**
- Create: `backend/src/services/embedding/openai.ts`
- Create: `backend/src/services/embedding/__tests__/openai.test.ts`

**Step 1：装依赖**

```powershell
npm -w backend install openai@^4.50.0
```

**Step 2：写实现**

```ts
import OpenAI from 'openai';
import { env } from '../../config/env';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

/**
 * Embed a single string. Throws on API failure — caller decides whether to
 * retry / queue / give up.
 */
export async function embed(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('embed(): empty text');
  }
  const trimmed = text.length > 8000 ? text.slice(0, 8000) : text;
  const r = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
  });
  const v = r.data[0]?.embedding;
  if (!v || v.length !== EMBEDDING_DIM) {
    throw new Error(`embed(): unexpected dim ${v?.length ?? 0}`);
  }
  return v;
}

/**
 * Embed multiple strings in a single API call (more efficient).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map(t => (t.length > 8000 ? t.slice(0, 8000) : t)),
  });
  return r.data.map(d => d.embedding);
}

/** node 的 embedding 文本 = name + description（如有） + tags（如有） */
export function nodeEmbeddingText(node: {
  name: string; description?: string | null; tags?: unknown;
}): string {
  const parts = [node.name];
  if (node.description) parts.push(node.description);
  if (Array.isArray(node.tags) && node.tags.length > 0) parts.push(node.tags.join(', '));
  return parts.join('\n');
}
```

**Step 3：测试（mock OpenAI）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embed, nodeEmbeddingText, EMBEDDING_DIM } from '../openai';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn(async ({ input }) => ({
        data: (Array.isArray(input) ? input : [input]).map(() => ({
          embedding: new Array(EMBEDDING_DIM).fill(0.1),
        })),
      })),
    },
  })),
}));

describe('embed', () => {
  it('returns a 1536-dim vector', async () => {
    const v = await embed('心率失常');
    expect(v.length).toBe(EMBEDDING_DIM);
  });
  it('throws on empty', async () => {
    await expect(embed('')).rejects.toThrow();
  });
});

describe('nodeEmbeddingText', () => {
  it('combines name + description + tags', () => {
    expect(nodeEmbeddingText({ name: 'A', description: 'B', tags: ['c', 'd'] }))
      .toBe('A\nB\nc, d');
  });
});
```

**Commit:** `feat(rag): openai embedding service`

---

## Task 2：节点 upsert hook 写 embedding（异步）

**Files:**
- Create: `backend/src/services/embedding/queue.ts`
- Modify: `backend/src/modules/nodes/node.service.ts`（PG 路径调用 hook）

**重要约束**：写 embedding 是 OpenAI API 调用，**不能阻塞 user request**。用一个简单的内存队列，背景跑：

```ts
// queue.ts
import { embed, nodeEmbeddingText } from './openai';
import { getPrisma } from '../../lib/prisma';

interface Task { node_id: string; text: string; }
const queue: Task[] = [];
let running = false;

export function enqueueEmbedding(node: { node_id: string; name: string; description?: string | null; tags?: unknown }): void {
  queue.push({ node_id: node.node_id, text: nodeEmbeddingText(node) });
  if (!running) void run();
}

async function run(): Promise<void> {
  running = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      const v = await embed(task.text);
      await getPrisma().$executeRaw`
        UPDATE nodes SET embedding = ${`[${v.join(',')}]`}::vector
        WHERE node_id = ${task.node_id}
      `;
    } catch (err) {
      console.error('[embedding-queue] failed for', task.node_id, err);
      // best effort: 失败的节点回填脚本会兜底
    }
  }
  running = false;
}
```

在 `NodeServicePg.create` / `update` / `createBatch` 末尾调 `enqueueEmbedding(node)`。

**测试**：mock `embed` 返回固定向量，验证 `nodes.embedding` 列被写入。

**Commit:** `feat(rag): async embedding write hook on node upsert`

---

## Task 3：search.service 实现

**Files:**
- Create: `backend/src/modules/search/search.service.ts`
- Create: `backend/src/modules/search/__tests__/search.service.test.ts`

```ts
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';
import { embed } from '../../services/embedding/openai';

export const SearchInput = z.object({
  q: z.string().min(1).max(500),
  k: z.number().int().min(1).max(50).default(10),
  include_neighbors: z.boolean().default(true),
});
export type SearchInputT = z.infer<typeof SearchInput>;

export interface SearchMatch {
  node: Record<string, unknown>;
  score: number;
  neighbors?: Array<Record<string, unknown>>;
}

export const SearchService = {
  async search(graph_id: string, input: SearchInputT): Promise<{ matches: SearchMatch[] }> {
    const queryVec = await embed(input.q);
    const vecLit = `[${queryVec.join(',')}]`;

    // pgvector cosine distance: <=> operator. 1 - distance = similarity.
    const rows = await getPrisma().$queryRaw<Array<Record<string, unknown> & { distance: number }>>`
      SELECT node_id, graph_id, node_type, knowledge_type, name, description,
             status, source, confidence, tags, ai_job_id, created_at, updated_at,
             (embedding <=> ${vecLit}::vector) AS distance
      FROM nodes
      WHERE graph_id = ${graph_id}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecLit}::vector
      LIMIT ${input.k}
    `;

    const matches: SearchMatch[] = rows.map(r => ({
      node: { ...r, distance: undefined },
      score: 1 - Number(r.distance),
    }));

    if (input.include_neighbors && matches.length > 0) {
      const ids = matches.map(m => (m.node as { node_id: string }).node_id);
      const rels = await getPrisma().relation.findMany({
        where: { OR: [{ source_id: { in: ids } }, { target_id: { in: ids } }] },
      });
      const neighborIds = new Set<string>();
      for (const r of rels) {
        if (ids.includes(r.source_id)) neighborIds.add(r.target_id);
        if (ids.includes(r.target_id)) neighborIds.add(r.source_id);
      }
      const neighbors = await getPrisma().node.findMany({ where: { node_id: { in: [...neighborIds] } } });
      const byNode: Record<string, Array<Record<string, unknown>>> = {};
      for (const m of matches) byNode[(m.node as { node_id: string }).node_id] = [];
      for (const r of rels) {
        if (byNode[r.source_id]) {
          const n = neighbors.find(x => x.node_id === r.target_id);
          if (n) byNode[r.source_id]!.push(n as unknown as Record<string, unknown>);
        }
        if (byNode[r.target_id]) {
          const n = neighbors.find(x => x.node_id === r.source_id);
          if (n) byNode[r.target_id]!.push(n as unknown as Record<string, unknown>);
        }
      }
      for (const m of matches) m.neighbors = byNode[(m.node as { node_id: string }).node_id] ?? [];
    }

    return { matches };
  },
};
```

**测试要点**：
- 构造 5 个节点 + 不同 mock embedding（手算余弦距离）
- 调 search，验证 top-k 顺序正确
- 验证 `neighbors` 含正确的 1 跳邻居
- 验证 `include_neighbors=false` 时不查 relation 表

**Commit:** `feat(rag): semantic search service via pgvector`

---

## Task 4：search.routes + mount

**Files:**
- Create: `backend/src/modules/search/search.routes.ts`
- Modify: `backend/src/index.ts`（加 `app.use('/api', searchRoutes)`）

```ts
import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { SearchInput, SearchService } from './search.service';
import { GraphService } from '../graphs/graph.service';

export const searchRoutes = Router();

searchRoutes.post('/graphs/:graph_id/search', requireAuth, async (req, res, next) => {
  try {
    const { graph_id } = req.params;
    const exists = await GraphService.findById(graph_id);
    if (!exists) return res.status(404).json({ error: 'graph not found' });
    const input = SearchInput.parse(req.body);
    const result = await SearchService.search(graph_id, input);
    res.json(result);
  } catch (err) { next(err); }
});
```

**测试**：用 supertest 起 in-memory app，验证 200 响应、404、400（empty q）。

**Commit:** `feat(rag): /api/graphs/:id/search route`

---

## Task 5：回填脚本（resume 友好）

**Files:** Create `backend/src/scripts/backfill-embeddings.ts`

```ts
import { getPrisma } from '../lib/prisma';
import { embedBatch, nodeEmbeddingText, EMBEDDING_DIM } from '../services/embedding/openai';

async function main() {
  const BATCH = 50;
  const RATE_LIMIT_MS = 1000; // 1 batch per second to stay under OpenAI tier-1 limits

  while (true) {
    const nodes = await getPrisma().$queryRaw<Array<{ node_id: string; name: string; description: string | null; tags: unknown }>>`
      SELECT node_id, name, description, tags FROM nodes
      WHERE embedding IS NULL
      LIMIT ${BATCH}
    `;
    if (nodes.length === 0) {
      console.log('all embeddings backfilled');
      break;
    }

    const texts = nodes.map(n => nodeEmbeddingText(n));
    const vecs = await embedBatch(texts);
    if (vecs.length !== nodes.length) throw new Error('mismatch');

    for (let i = 0; i < nodes.length; i++) {
      const v = vecs[i]!;
      if (v.length !== EMBEDDING_DIM) throw new Error('bad dim');
      const lit = `[${v.join(',')}]`;
      await getPrisma().$executeRaw`
        UPDATE nodes SET embedding = ${lit}::vector WHERE node_id = ${nodes[i]!.node_id}
      `;
    }
    console.log(`embedded ${nodes.length} nodes`);
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

**特性**：
- 每次 SELECT WHERE embedding IS NULL → 中断后重跑只处理剩下的（resume）
- 50 行/批 + 1 秒间隔 → 默认对 OpenAI tier-1 限速友好
- 维度校验防止空响应造成损坏

**Commit:** `feat(scripts): backfill embeddings for existing nodes`

---

## Verification

1. `npm -w backend test` 全过（包含 Pack C 新测试）
2. 手动跑 `tsx backend/src/scripts/backfill-embeddings.ts`，验证 nodes 的 embedding 列被填
3. 手动调：`curl -X POST http://localhost:3001/api/graphs/G_xxx/search -H 'Authorization: Bearer ...' -d '{"q":"心率波动"}'`
4. 验证返回 top-k，分数有意义（>0.5 算合理 hit）
5. 同义近义词测试：构造"心率失常""心率不齐"两个节点，q="心律失常"，验证两者都在 top-3 且 score 接近

---

## 风险

- **OpenAI 限流**：tier-1 是 3000 RPM。回填脚本默认 60 RPM 安全。
- **写 embedding 失败**：异步队列吞错误后由回填脚本兜底，不影响 user request 路径。
- **embedding 列空**：search 会 `WHERE embedding IS NOT NULL` 过滤，不会返回未嵌入的节点 — 提示用户跑回填。

---

## Commits 总数

约 5 个：openai service、queue+hook、search service、search route、backfill 脚本。
