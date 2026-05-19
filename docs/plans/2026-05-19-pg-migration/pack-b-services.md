# Pack B — Service 层 Cypher → Prisma 移植

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 把 `graph.service.ts` / `node.service.ts` / `relation.service.ts` / `services/neo4j/bulk.ts` 里**所有** Cypher 调用移植成 Prisma 调用，**保持 service 层公共方法签名 0 改动**，前端 API 契约 0 改动。

**Architecture:** 用环境变量 `STORAGE_BACKEND=pg|neo4j` 做切换层（默认 `neo4j` 保持向后兼容），service 内部按变量选择实现；测试默认走 `pg`。Pack C/D 在 PG 路径上扩展。

**Tech Stack:** Prisma 5.x · Postgres · vitest

---

## 工作分支

`feature/pg-migration-pack-b-services`

## 输出目录（仅本 Pack 可写）

- `backend/src/modules/graphs/graph.service.ts`（重写实现，保持导出名）
- `backend/src/modules/nodes/node.service.ts`
- `backend/src/modules/relations/relation.service.ts`
- `backend/src/services/pg/bulk.ts`（**新增**，取代 `services/neo4j/bulk.ts` — 但不删旧文件）
- `backend/src/lib/storage-backend.ts`（**新增**，环境变量切换）
- `backend/src/lib/prisma.ts`（**新增**，PrismaClient 单例 — 如已存在跳过）
- `backend/src/__tests__/setup.ts`（改 cleanup 逻辑）
- 各 service 的 `__tests__/*.test.ts`（必要时改 setup）

## 边界（不可动）

- `backend/src/lib/neo4j.ts`（保留）
- `backend/src/services/neo4j/`（保留，回退用）
- `backend/prisma/schema.prisma`（Pack A 已定）
- 前端任何代码
- Pack C 的目录 `backend/src/services/embedding/` `backend/src/modules/search/`
- Pack D 的目录 `backend/src/modules/learning/`

## 关键依赖

- ✅ Pack A 完成（schema 已就绪）
- ✅ neo4j-driver 仍在依赖（双写/双读期间需要）

---

## Task 0：建 PrismaClient 单例

**Files:** Create `backend/src/lib/prisma.ts`（如已存在跳过）

```ts
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'test' ? [] : ['warn', 'error'],
    });
  }
  return client;
}

export async function closePrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
```

**Commit:** `feat(db): prisma client singleton`

---

## Task 1：storage-backend 切换层

**Files:** Create `backend/src/lib/storage-backend.ts`

```ts
export type StorageBackend = 'pg' | 'neo4j';

export function getStorageBackend(): StorageBackend {
  const v = process.env.STORAGE_BACKEND?.toLowerCase();
  if (v === 'pg') return 'pg';
  return 'neo4j';
}
```

**测试**：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getStorageBackend } from '../storage-backend';

describe('getStorageBackend', () => {
  const orig = process.env.STORAGE_BACKEND;
  afterEach(() => { process.env.STORAGE_BACKEND = orig; });
  it('defaults to neo4j', () => {
    delete process.env.STORAGE_BACKEND;
    expect(getStorageBackend()).toBe('neo4j');
  });
  it('returns pg when set', () => {
    process.env.STORAGE_BACKEND = 'pg';
    expect(getStorageBackend()).toBe('pg');
  });
});
```

**Commit:** `feat(db): storage backend switch (pg|neo4j)`

---

## Task 2：GraphService.list / findById / create / update / remove → Prisma

**Files:** `backend/src/modules/graphs/graph.service.ts`

**保持的导出名**：`GraphService`, `CreateGraphSchema`, `CreateGraphInput`, `UpdateGraphSchema`, `UpdateGraphInput`, `GraphRecord`, `GraphDetail`

**实现策略**：
- 提取 `GraphServiceNeo4j`（现有实现迁过去）
- 新增 `GraphServicePg`（用 Prisma 实现同样的方法签名）
- `GraphService` 改为根据 `getStorageBackend()` 转发的代理

PG 实现关键点：

```ts
const GraphServicePg = {
  async list(): Promise<GraphRecord[]> {
    // node_count / relation_count 用聚合子查询
    const rows = await getPrisma().$queryRaw<Array<GraphRecord & { node_count: bigint; relation_count: bigint }>>`
      SELECT g.*,
             COALESCE(nc.cnt, 0) AS node_count,
             COALESCE(rc.cnt, 0) AS relation_count
      FROM graphs g
      LEFT JOIN (SELECT graph_id, COUNT(*) AS cnt FROM nodes GROUP BY graph_id) nc
        ON nc.graph_id = g.graph_id
      LEFT JOIN (SELECT graph_id, COUNT(*) AS cnt FROM relations GROUP BY graph_id) rc
        ON rc.graph_id = g.graph_id
      ORDER BY g.created_at DESC
    `;
    return rows.map(r => ({ ...r, node_count: Number(r.node_count), relation_count: Number(r.relation_count) }));
  },

  async findById(graph_id: string): Promise<GraphDetail | null> {
    const g = await getPrisma().graph.findUnique({ where: { graph_id } });
    if (!g) return null;
    const [nodes, relations] = await Promise.all([
      getPrisma().node.findMany({ where: { graph_id }, orderBy: { created_at: 'asc' } }),
      getPrisma().relation.findMany({ where: { graph_id } }),
    ]);
    return {
      graph: { ...g, node_count: nodes.length, relation_count: relations.length } as GraphRecord,
      nodes: nodes as Array<Record<string, unknown>>,
      relations: relations.map(r => ({
        ...r,
        relation_id: r.relation_id.toString(),  // BigInt → string，前端兼容
      })),
    };
  },

  async create(input: CreateGraphInput): Promise<GraphRecord> {
    const graph_id = generateGraphId();
    const created = await getPrisma().graph.create({
      data: {
        graph_id,
        graph_name: input.graph_name,
        graph_type: input.graph_type,
        subject: input.subject ?? null,
        course_name: input.course_name ?? null,
        description: input.description ?? null,
        created_by: input.created_by,
      },
    });
    return { ...created, node_count: 0, relation_count: 0 } as GraphRecord;
  },

  async update(graph_id, patch): Promise<GraphRecord | null> { /* prisma.graph.update */ },
  async remove(graph_id): Promise<boolean> { /* prisma.graph.delete + cascade */ },
};

export const GraphService = getStorageBackend() === 'pg' ? GraphServicePg : GraphServiceNeo4j;
```

**测试**：现有测试 `backend/src/modules/graphs/__tests__/graph.service.test.ts` 在 STORAGE_BACKEND=pg 下应全过。失败的 case 暴露的是行为不等价，必须修。

**Commit:** `feat(db): port GraphService to Prisma behind storage backend switch`

---

## Task 3：NodeService 移植

**保持的导出名**：`NodeService`, `NodeListQuery`, `NodeListResult`

**关键方法签名（已现有）**：
- `create(graphId, input)` → `Node`
- `list(graphId, q: NodeListQuery)` → `NodeListResult`
- `update(node_id, patch)` → `Node | null`
- `remove(node_id)` → `boolean`
- `createBatch(graphId, inputs[], opts)` → `Array<Node>` （用于 AI ingest）
- 还有 listByJob / approveBatch / rejectBatch 等批量方法（参见现有源码 line 199-296）

**PG 实现要点**：
- `list` 的 `q` 含 `q.q`（搜索词）/ `q.node_type` / `q.status` / `q.cursor` / `q.limit` — 全部转 `prisma.node.findMany({ where, take, skip })`
- `createBatch` 用 `prisma.$transaction` + `INSERT ... ON CONFLICT (node_id) DO UPDATE SET ... RETURNING *`（raw SQL，比 N 个 upsert 快）
- 关键：node_id 在 input 里可能未设，要用 `generateNodeId()`（看现有源码怎么做的）

**测试**：现有测试 `node.service.test.ts` 全过。

**Commit:** `feat(db): port NodeService to Prisma`

---

## Task 4：RelationService 移植

**保持的导出名**：`RelationService`, `RelationUpdateInput`

**关键 trick**：现有 Cypher 用 `id(r)` 作为 relation_id；PG 用 BIGSERIAL。返回时 `String(relation.relation_id)` 即可。前端已经把 relation_id 当字符串处理（见 commit 7ef8648 的修复）。

**唯一棘手点**：`@@unique([source_id, target_id, relation_type])` — 同一对节点 + 同一类型不允许重复。如果业务要"同一对节点同一类型可以多条"，需要解除这个约束（与 Pack A 协调）。**默认认为这是合理的去重等价于 Neo4j MERGE**。

**Commit:** `feat(db): port RelationService to Prisma`

---

## Task 5：bulk ingest（AI 批量导入）

**Files:**
- Create: `backend/src/services/pg/bulk.ts`
- 把 `backend/src/services/neo4j/bulk.ts` 里的 `bulkUpsert(graphId, nodes, relations, opts)` 等价实现搬过来

**关键事务**：

```ts
import { getPrisma } from '../../lib/prisma';

export async function bulkUpsert(
  graphId: string,
  nodes: Array<NodeInput>,
  relations: Array<RelationInput>,
  opts: { jobId?: string } = {},
) {
  return getPrisma().$transaction(async (tx) => {
    // 1. 节点先 upsert（关系外键依赖节点存在）
    for (const n of nodes) {
      await tx.node.upsert({
        where: { node_id: n.node_id },
        create: { ...n, graph_id: graphId, ai_job_id: opts.jobId },
        update: { ...n, ai_job_id: opts.jobId, updated_at: new Date() },
      });
    }
    // 2. 关系 upsert（unique constraint 上面）
    for (const r of relations) {
      await tx.relation.upsert({
        where: {
          relations_unique_edge: {
            source_id: r.source_id,
            target_id: r.target_id,
            relation_type: r.relation_type,
          },
        },
        create: { ...r, graph_id: graphId, ai_job_id: opts.jobId },
        update: { ...r, ai_job_id: opts.jobId, updated_at: new Date() },
      });
    }
    return { nodesWritten: nodes.length, relationsWritten: relations.length };
  });
}
```

**调用方切换**：找出 `services/neo4j/bulk` 的所有 import，按 storage-backend 切换：

```ts
import { getStorageBackend } from '../../lib/storage-backend';
const bulkUpsert = getStorageBackend() === 'pg'
  ? (await import('../pg/bulk')).bulkUpsert
  : (await import('../neo4j/bulk')).bulkUpsert;
```

或更简单：在 `services/index.ts` 里 re-export 切换好的实现。

**Commit:** `feat(db): port bulk ingest to Prisma transaction`

---

## Task 6：测试 setup 改造

**Files:** `backend/src/__tests__/setup.ts`

现有逻辑（grep 已确认）：

```ts
await runQuery('MATCH (n) DETACH DELETE n');
```

改成：

```ts
import { getPrisma } from '../lib/prisma';
import { getStorageBackend } from '../lib/storage-backend';
import { runQuery } from '../lib/neo4j';

beforeEach(async () => {
  if (getStorageBackend() === 'pg') {
    // 顺序：relations → nodes → graphs（FK cascade 也行，但显式更清晰）
    await getPrisma().$executeRawUnsafe('TRUNCATE relations, nodes, graphs CASCADE');
  } else {
    await runQuery('MATCH (n) DETACH DELETE n');
  }
});
```

**测试运行环境**：CI / 本地 default 用 `STORAGE_BACKEND=pg`（在 `vitest.config.ts` 或 `.env.test` 里设）。

**Commit:** `test(db): switch test cleanup to Postgres truncate`

---

## Task 7：跑全套验证

```powershell
$env:STORAGE_BACKEND="pg"
cd backend
npm test
```

预期：现有所有 backend vitest 全过（不增不减新测试，只换实现）。

如果有 Cypher 特定行为依赖（比如 Neo4j 的 datetime() 序列化）暴露不一致，**调整 PG 实现匹配预期返回值**，不要改测试。

```powershell
npm run build  # tsc
```

**Commit:** `test(db): vitest full suite passes on Postgres backend`

---

## Verification

1. `STORAGE_BACKEND=pg npm -w backend test` 全过
2. `STORAGE_BACKEND=neo4j npm -w backend test` 仍全过（向后兼容）
3. 手动 e2e：用 Pack A 的 migrate-from-neo4j 同步数据，前端连后端（PG 模式），打开图谱编辑器验证：
   - 图谱列表可见
   - 选中图谱看到全部节点/关系
   - 增删改节点/关系 OK
   - Focus Mode 仍工作（前端无感）
4. AI 批量生成：触发一次 AI 生成图谱，验证节点/关系都写入 PG，job_id 关联正确

---

## 回退

环境变量 `STORAGE_BACKEND=neo4j` 立刻切回。任何 Pack B 引入的 bug 都可以这样在生产环境绕开。

---

## Commits 总数

约 7 个：prisma 单例、backend switch、Graph service、Node service、Relation service、bulk、test setup 切换。
