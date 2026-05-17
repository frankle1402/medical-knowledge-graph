# Agent-B — Neo4j 图谱服务实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 在 backend 中实现 Neo4j 数据访问层与 `/api/graphs`、`/api/nodes`、`/api/relations`、`/api/graphs/:id/export` 全部业务路由，覆盖设计文档 §3.1–§3.3 的节点/关系/图谱数据模型，并在启动时建立约束与索引。

**架构（Architecture）:** 单例 `Neo4jDriver` + 每请求 `Session`；统一 `Cypher` 工具仅接受参数化查询；以 `BELONGS_TO_GRAPH` 关系区分图谱归属，节点本身不重复；Express 路由调用 `GraphService / NodeService / RelationService`，service 返回纯 DTO 由 Zod 校验后返回。

**技术栈:** neo4j-driver 5.x · Cypher 5 · Express · zod · vitest（单测使用真实本地 Neo4j 测试库 `mkg_test`）。

---

## 工作分支

`feature/agent-b-neo4j-graph`

## 输出目录（仅本 Agent 可写）

- `backend/src/lib/neo4j.ts`（driver 单例）
- `backend/src/scripts/neo4j-init.ts`（约束与索引）
- `backend/src/modules/graphs/`
- `backend/src/modules/nodes/`
- `backend/src/modules/relations/`
- `backend/src/services/neo4j/`（共享 Cypher 工具）

## 关键依赖

- ✅ Agent-G `Task 1-7` 完成（本地 Neo4j 5 已装好，bolt://localhost:7687 可连）
- ✅ Agent-F 已发布节点/关系 Zod schema
- ✅ Agent-A 已实现 `auth` 中间件、`errorHandler`、`requireRole`

---

## Task 1：`neo4j-driver` 安装与 driver 单例

**Files:**
- Modify: `backend/package.json` （加依赖）
- Create: `backend/src/lib/neo4j.ts`
- Create: `backend/src/lib/__tests__/neo4j.test.ts`

**Step 1：装依赖**

Run: `npm -w backend install neo4j-driver@5.24.0`
Expected: 成功。

**Step 2：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { getDriver, runQuery } from '../neo4j';

describe('neo4j driver', () => {
  it('能连通本地 Neo4j 并跑 RETURN 1', async () => {
    const result = await runQuery<{ x: number }>('RETURN 1 AS x');
    expect(result[0]?.x).toBe(1);
  });
  it('参数化查询返回参数', async () => {
    const result = await runQuery<{ name: string }>('RETURN $name AS name', { name: '李智高' });
    expect(result[0]?.name).toBe('李智高');
  });
});
```

**Step 3：跑测试看失败**

Run: `npm -w backend test src/lib`
Expected: FAIL — 模块不存在。

**Step 4：实现 `lib/neo4j.ts`**

```ts
import neo4j, { Driver, Session } from 'neo4j-driver';
import { env } from '../config/env';

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 30_000,
    });
  }
  return driver;
}

export async function runQuery<T = unknown>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session: Session = getDriver().session();
  try {
    const res = await session.run(cypher, params);
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
```

**Step 5：跑测试通过**

Run: `npm -w backend test src/lib`
Expected: PASS（前提：本地 Neo4j 已启动）。

**Step 6：Commit**

```powershell
git add backend/src/lib/neo4j.ts backend/src/lib/__tests__/neo4j.test.ts backend/package.json
git commit -m "feat(agent-b): add neo4j driver singleton"
```

---

## Task 2：约束与索引初始化脚本

**Files:**
- Create: `backend/src/scripts/neo4j-init.ts`

**Step 1：写脚本**

```ts
import { runQuery, closeDriver } from '../lib/neo4j';

const CONSTRAINTS = [
  // 节点唯一约束
  'CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.node_id IS UNIQUE',
  'CREATE CONSTRAINT graph_id_unique IF NOT EXISTS FOR (g:Graph) REQUIRE g.graph_id IS UNIQUE',
  // 索引
  'CREATE INDEX node_type_idx IF NOT EXISTS FOR (n:Node) ON (n.node_type)',
  'CREATE INDEX node_status_idx IF NOT EXISTS FOR (n:Node) ON (n.status)',
  'CREATE INDEX node_name_idx IF NOT EXISTS FOR (n:Node) ON (n.name)',
];

async function main() {
  for (const c of CONSTRAINTS) {
    console.log('▶', c);
    await runQuery(c);
  }
  console.log('✅ Neo4j schema initialized');
  await closeDriver();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Step 2：执行**

Run: `npm -w backend run neo4j:init`
Expected: 6 行 `▶` 输出 + 最后 `✅ Neo4j schema initialized`。

**Step 3：在 Neo4j Browser 验证**

执行：`SHOW CONSTRAINTS;` 应能看到 `node_id_unique` 与 `graph_id_unique`。

**Step 4：Commit**

```powershell
git add backend/src/scripts/neo4j-init.ts
git commit -m "feat(agent-b): add neo4j schema init script"
```

---

## Task 3：通用 Node ID 生成器（薄封装，单一真理源在 Agent-F）

**Files:**
- Create: `backend/src/services/neo4j/id.ts`
- Create: `backend/src/services/neo4j/__tests__/id.test.ts`

> 决策：Agent-F 已经在 `@mkg/shared/utils/id` 提供 `generateNodeId / generateGraphId / isValidNodeId`，本文件**仅 re-export**，避免实现分裂、前缀漂移。

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { generateNodeId, generateGraphId } from '../id';

describe('id generator (re-export from @mkg/shared)', () => {
  it('generateNodeId 返回带前缀的唯一 id', () => {
    const a = generateNodeId('knowledge_point');
    const b = generateNodeId('knowledge_point');
    expect(a).toMatch(/^KP_/);
    expect(a).not.toBe(b);
  });
  it('generateGraphId 返回 graph_ 前缀', () => {
    expect(generateGraphId()).toMatch(/^graph_/);
  });
});
```

**Step 2：实现**

```ts
// backend/src/services/neo4j/id.ts
export { generateNodeId, generateGraphId, isValidNodeId } from '@mkg/shared';
```

**Step 3：测试通过 + Commit**

Run: `npm -w backend test src/services/neo4j`

```powershell
git add backend/src/services/neo4j/id.ts backend/src/services/neo4j/__tests__/id.test.ts
git commit -m "feat(agent-b): add node/graph id generator"
```

---

## Task 4：`GraphService.create` 与 `POST /api/graphs`

**Files:**
- Create: `backend/src/modules/graphs/graph.service.ts`
- Create: `backend/src/modules/graphs/graph.routes.ts`
- Create: `backend/src/modules/graphs/__tests__/graph.service.test.ts`
- Modify: `backend/src/app.ts`（挂载路由）

**Step 1：测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runQuery } from '../../../lib/neo4j';
import { GraphService } from '../graph.service';

describe('GraphService.create', () => {
  beforeEach(async () => {
    await runQuery('MATCH (g:Graph) DETACH DELETE g');
  });

  it('创建图谱节点并返回完整 DTO', async () => {
    const dto = await GraphService.create({
      graph_name: '基础护理学知识图谱',
      graph_type: 'course',
      subject: '护理学',
      course_name: '基础护理学',
      created_by: 'user-uuid',
    });
    expect(dto.graph_id).toMatch(/^graph_/);
    expect(dto.node_count).toBe(0);
    expect(dto.relation_count).toBe(0);
  });
});
```

**Step 2：实现 service**

```ts
import { z } from 'zod';
import { runQuery } from '../../lib/neo4j';
import { generateGraphId } from '../../services/neo4j/id';
import { GraphType } from '@mkg/shared';

export const CreateGraphSchema = z.object({
  graph_name: z.string().min(1).max(100),
  graph_type: GraphType,
  subject: z.string().max(50).optional(),
  course_name: z.string().max(100).optional(),
  description: z.string().optional(),
  created_by: z.string().uuid(),
});
export type CreateGraphInput = z.infer<typeof CreateGraphSchema>;

export const GraphService = {
  async create(input: CreateGraphInput) {
    const graph_id = generateGraphId();
    const now = new Date().toISOString();
    const params = { graph_id, ...input, status: 'active', created_at: now };
    const rows = await runQuery<{ g: Record<string, unknown> }>(
      `CREATE (g:Graph $props) RETURN g { .* } AS g`,
      { props: params },
    );
    return { ...rows[0]!.g, node_count: 0, relation_count: 0 };
  },
};
```

**Step 3：路由**

```ts
import { Router } from 'express';
import { CreateGraphSchema, GraphService } from './graph.service';
import { requireAuth, requireRole } from '../../middleware/auth';

export const graphRouter = Router();

graphRouter.post('/', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const input = CreateGraphSchema.parse({ ...req.body, created_by: req.user!.id });
    const graph = await GraphService.create(input);
    res.status(201).json(graph);
  } catch (e) { next(e); }
});
```

**Step 4：在 `app.ts` 挂载**

```ts
import { graphRouter } from './modules/graphs/graph.routes';
app.use('/api/graphs', graphRouter);
```

**Step 5：测试 + Commit**

```powershell
git add backend/src/modules/graphs backend/src/app.ts
git commit -m "feat(agent-b): POST /api/graphs"
```

---

## Task 5：`GET /api/graphs` 列表与 `GET /api/graphs/:id` 详情

**Files:**
- Modify: `backend/src/modules/graphs/graph.service.ts`
- Modify: `backend/src/modules/graphs/graph.routes.ts`
- Modify: `backend/src/modules/graphs/__tests__/graph.service.test.ts`

**契约要点（与设计文档 §5.1 对齐，前端 Agent-D 依赖此形态）：**

- `GET /api/graphs` 返回 `Graph[]`，每条带 `node_count`、`relation_count`
- `GET /api/graphs/:id` 返回 **`{ graph: Graph & { node_count, relation_count }, nodes: Node[], relations: Relation[] }`**（含图主体），前端 setGraph 时直接消费

**Step 1：增加测试**

```ts
it('list 返回所有图谱', async () => {
  await GraphService.create({ graph_name: 'A', graph_type: 'course', created_by: 'u' });
  await GraphService.create({ graph_name: 'B', graph_type: 'course', created_by: 'u' });
  const list = await GraphService.list();
  expect(list.length).toBeGreaterThanOrEqual(2);
});

it('findById 返回 graph + nodes + relations 三元组', async () => {
  const g = await GraphService.create({ graph_name: 'C', graph_type: 'course', created_by: 'u' });
  const found = await GraphService.findById(g.graph_id);
  expect(found?.graph.graph_id).toBe(g.graph_id);
  expect(Array.isArray(found?.nodes)).toBe(true);
  expect(Array.isArray(found?.relations)).toBe(true);
});
```

**Step 2：实现**

```ts
async list() {
  const rows = await runQuery<{ g: any; nc: number; rc: number }>(`
    MATCH (g:Graph)
    OPTIONAL MATCH (g)<-[:BELONGS_TO_GRAPH]-(n:Node)
    WITH g, count(DISTINCT n) AS nc
    OPTIONAL MATCH (a:Node)-[r]->(b:Node)
      WHERE (a)-[:BELONGS_TO_GRAPH]->(g) AND (b)-[:BELONGS_TO_GRAPH]->(g)
    RETURN g { .* } AS g, nc, count(r) AS rc
    ORDER BY g.created_at DESC
  `);
  return rows.map((r) => ({ ...r.g, node_count: r.nc, relation_count: r.rc }));
},

async findById(graph_id: string) {
  const meta = await runQuery<{ g: any; nc: number; rc: number }>(`
    MATCH (g:Graph {graph_id: $graph_id})
    OPTIONAL MATCH (g)<-[:BELONGS_TO_GRAPH]-(n:Node)
    WITH g, count(DISTINCT n) AS nc
    OPTIONAL MATCH (a:Node)-[r]->(b:Node)
      WHERE (a)-[:BELONGS_TO_GRAPH]->(g) AND (b)-[:BELONGS_TO_GRAPH]->(g)
    RETURN g { .* } AS g, nc, count(r) AS rc
  `, { graph_id });
  if (!meta[0]) return null;

  const nodes = await runQuery<{ n: any }>(`
    MATCH (g:Graph {graph_id: $graph_id})<-[:BELONGS_TO_GRAPH]-(n:Node)
    RETURN n { .* } AS n
  `, { graph_id });

  const relations = await runQuery<{ r: any; type: string; sid: string; tid: string }>(`
    MATCH (g:Graph {graph_id: $graph_id})
    MATCH (a:Node)-[r]->(b:Node)
    WHERE (a)-[:BELONGS_TO_GRAPH]->(g) AND (b)-[:BELONGS_TO_GRAPH]->(g)
    RETURN r { .* } AS r, type(r) AS type, a.node_id AS sid, b.node_id AS tid
  `, { graph_id });

  return {
    graph: { ...meta[0].g, node_count: meta[0].nc, relation_count: meta[0].rc },
    nodes: nodes.map((x) => x.n),
    relations: relations.map((x) => ({ ...x.r, source_id: x.sid, target_id: x.tid, relation_type: x.type })),
  };
},
```

**Step 3：路由 + 测试 + Commit**

```ts
graphRouter.get('/', requireAuth, async (_req, res, next) => {
  try { res.json(await GraphService.list()); } catch (e) { next(e); }
});
graphRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await GraphService.findById(req.params.id);
    if (!result) return res.status(404).json({ error: 'graph not found' });
    res.json(result); // { graph, nodes, relations }
  } catch (e) { next(e); }
});
```

```powershell
git add backend/src/modules/graphs
git commit -m "feat(agent-b): list endpoint + detail returns {graph,nodes,relations}"
```

---

## Task 6：`PUT /api/graphs/:id` 与 `DELETE /api/graphs/:id`

**Step 1：测试**

- 更新 `graph_name`, `description`，断言返回新字段；operator 调用应 403。
- 删除后 `findById` 应返回 `null`，且关联节点的 `BELONGS_TO_GRAPH` 关系一并清除（DETACH DELETE Graph 节点）；operator 调用应 403。

**Step 2：service 实现**

```ts
async update(graph_id: string, patch: Partial<CreateGraphInput>) {
  const rows = await runQuery(`
    MATCH (g:Graph {graph_id: $graph_id})
    SET g += $patch, g.updated_at = datetime()
    RETURN g { .* } AS g
  `, { graph_id, patch });
  return rows[0] as { g: any } | undefined;
},
async remove(graph_id: string) {
  await runQuery(`MATCH (g:Graph {graph_id: $graph_id}) DETACH DELETE g`, { graph_id });
}
```

**Step 3：路由（含 RBAC）**

```ts
graphRouter.put('/:id', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const r = await GraphService.update(req.params.id, req.body);
    if (!r) return res.status(404).json({ error: 'graph not found' });
    res.json(r.g);
  } catch (e) { next(e); }
});

graphRouter.delete('/:id', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try { await GraphService.remove(req.params.id); res.status(204).end(); } catch (e) { next(e); }
});
```

**Step 4：Commit**

```powershell
git commit -m "feat(agent-b): update and delete graph with rbac"
```

---

## Task 7：`NodeService` + `POST /api/graphs/:id/nodes`

**Files:**
- Create: `backend/src/modules/nodes/node.service.ts`
- Create: `backend/src/modules/nodes/node.routes.ts`
- Create: `backend/src/modules/nodes/__tests__/node.service.test.ts`

**Step 1：测试**

```ts
it('createNode 在指定图谱下创建并自动建立 BELONGS_TO_GRAPH', async () => {
  const g = await GraphService.create({ graph_name: 'X', graph_type: 'course', created_by: 'u' });
  const n = await NodeService.create(g.graph_id, {
    node_type: 'knowledge_point',
    name: '静脉输液',
    knowledge_type: '操作流程类',
    difficulty: '中等',
    importance: '重点掌握',
    source: 'manual',
    created_by: 'u',
  });
  expect(n.node_id).toMatch(/^KP_/);
});
```

**Step 2：实现**

```ts
import { z } from 'zod';
import { NodeBaseSchema, NodeUnion } from '@mkg/shared';
import { runQuery } from '../../lib/neo4j';
import { generateNodeId } from '../../services/neo4j/id';

export const NodeService = {
  async create(graph_id: string, input: z.infer<typeof NodeUnion>) {
    const node_id = input.node_id ?? generateNodeId(input.node_type);
    const props = { ...input, node_id, status: input.status ?? 'approved', created_at: new Date().toISOString() };
    const rows = await runQuery(`
      MATCH (g:Graph {graph_id: $graph_id})
      CREATE (n:Node $props)
      MERGE (n)-[:BELONGS_TO_GRAPH]->(g)
      RETURN n { .* } AS n
    `, { graph_id, props });
    return rows[0]?.n;
  },
};
```

**Step 3：路由**

```ts
nodeRouter.post('/graphs/:id/nodes', requireAuth, requireRole('admin', 'expert'),
  async (req, res, next) => {
    try {
      const input = NodeUnion.parse({ ...req.body, created_by: req.user!.id });
      const n = await NodeService.create(req.params.id, input);
      res.status(201).json(n);
    } catch (e) { next(e); }
  }
);
```

**Step 4：Commit**

```powershell
git commit -m "feat(agent-b): create node under graph"
```

---

## Task 8：`GET /api/graphs/:id/nodes` 列表（支持筛选 + 分页）

**Files:**
- Modify: `backend/src/modules/nodes/node.service.ts`
- Modify: `backend/src/modules/nodes/node.routes.ts`
- Modify: `backend/src/modules/nodes/__tests__/node.routes.test.ts`

**契约：**

- `GET /api/graphs/:id/nodes?node_type=&status=&keyword=&skip=0&limit=50`
  - 任何登录用户可读
  - query 全部 optional；`limit` 默认 50，上限 200；`skip` 默认 0
  - 200 响应：`{ items: Node[], total: number, skip: number, limit: number }`
  - 404：图谱不存在
  - keyword 走 `toLower(n.name) CONTAINS toLower($keyword)`，**只走参数化**，不拼字符串（防 Cypher 注入）

**Step 1：写测试**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { GraphService } from '../../graphs/graph.service';
import { NodeService } from '../node.service';
import { signToken } from '../../../lib/jwt';

const app = createApp();

describe('GET /api/graphs/:id/nodes', () => {
  let graphId: string;
  let token: string;

  beforeAll(async () => {
    token = signToken({ id: 'u1', role: 'admin' });
    const g = await GraphService.create({ graph_name: 'list-test', graph_type: 'course', created_by: '00000000-0000-0000-0000-000000000001' });
    graphId = g.graph_id;
    await NodeService.create(graphId, { node_type: 'knowledge_point', name: '心率监测' } as any);
    await NodeService.create(graphId, { node_type: 'knowledge_point', name: '血压测量' } as any);
    await NodeService.create(graphId, { node_type: 'term',            name: '收缩压' } as any);
  });

  it('无过滤返回全部', async () => {
    const r = await request(app).get(`/api/graphs/${graphId}/nodes`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(3);
    expect(r.body.total).toBe(3);
    expect(r.body.skip).toBe(0);
    expect(r.body.limit).toBe(50);
  });

  it('node_type 过滤', async () => {
    const r = await request(app).get(`/api/graphs/${graphId}/nodes?node_type=term`).set('Authorization', `Bearer ${token}`);
    expect(r.body.items.length).toBe(1);
    expect(r.body.items[0].name).toBe('收缩压');
  });

  it('keyword 模糊匹配（大小写 + Unicode）', async () => {
    const r = await request(app).get(`/api/graphs/${graphId}/nodes?keyword=测`).set('Authorization', `Bearer ${token}`);
    expect(r.body.items.map((n: any) => n.name).sort()).toEqual(['血压测量', '心率监测']);
  });

  it('Cypher 注入字符串被参数化保护', async () => {
    const r = await request(app)
      .get(`/api/graphs/${graphId}/nodes?keyword=' OR 1=1//`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(0);
  });

  it('skip / limit 分页', async () => {
    const r = await request(app).get(`/api/graphs/${graphId}/nodes?skip=1&limit=1`).set('Authorization', `Bearer ${token}`);
    expect(r.body.items.length).toBe(1);
    expect(r.body.total).toBe(3);
  });

  it('limit 上限 200', async () => {
    const r = await request(app).get(`/api/graphs/${graphId}/nodes?limit=999`).set('Authorization', `Bearer ${token}`);
    expect(r.body.limit).toBeLessThanOrEqual(200);
  });

  it('图不存在 → 404', async () => {
    const r = await request(app).get(`/api/graphs/graph_doesnotexist/nodes`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(404);
  });
});
```

**Step 2：实现 service**

```ts
// node.service.ts 中追加
import type { NodeType, NodeStatus } from '@mkg/shared';

export interface ListNodesQuery {
  node_type?: NodeType;
  status?: NodeStatus;
  keyword?: string;
  skip: number;
  limit: number;
}

NodeService.list = async function list(graphId: string, q: ListNodesQuery) {
  const params = {
    graph_id: graphId,
    node_type: q.node_type ?? null,
    status: q.status ?? null,
    keyword: q.keyword ?? null,
    skip: q.skip,
    limit: q.limit,
  };

  const items = await runQuery<{ n: any }>(
    `MATCH (n:Node)-[:BELONGS_TO_GRAPH]->(g:Graph {graph_id: $graph_id})
     WHERE ($node_type IS NULL OR n.node_type = $node_type)
       AND ($status    IS NULL OR n.status    = $status)
       AND ($keyword   IS NULL OR toLower(n.name) CONTAINS toLower($keyword))
     RETURN n { .* } AS n
     ORDER BY n.created_at DESC
     SKIP $skip LIMIT $limit`,
    params,
  );

  const totalRows = await runQuery<{ total: number }>(
    `MATCH (n:Node)-[:BELONGS_TO_GRAPH]->(g:Graph {graph_id: $graph_id})
     WHERE ($node_type IS NULL OR n.node_type = $node_type)
       AND ($status    IS NULL OR n.status    = $status)
       AND ($keyword   IS NULL OR toLower(n.name) CONTAINS toLower($keyword))
     RETURN count(n) AS total`,
    params,
  );

  return {
    items: items.map((x) => x.n as Node),
    total: Number(totalRows[0]?.total ?? 0),
    skip: q.skip,
    limit: q.limit,
  };
};
```

**Step 3：实现 routes**

```ts
import { NodeType, NodeStatus } from '@mkg/shared';

const ListQuery = z.object({
  node_type: NodeType.optional(),
  status: NodeStatus.optional(),
  keyword: z.string().max(100).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

graphRouter.get('/:id/nodes', requireAuth, async (req, res, next) => {
  try {
    const exists = await GraphService.exists(req.params.id);
    if (!exists) return res.status(404).json({ error: 'graph not found' });
    const q = ListQuery.parse(req.query);
    res.json(await NodeService.list(req.params.id, q));
  } catch (e) { next(e); }
});
```

**Step 4：DoD**

- ✅ 7 条用例全部通过（含 Cypher 注入测试）
- ✅ 响应字段名严格为 `{ items, total, skip, limit }`
- ✅ `limit` 上限 200 在 zod 层强制

**Step 5：Commit**

```powershell
git commit -m "feat(agent-b): list nodes with filters and pagination"
```

---

## Task 9：`PUT /api/nodes/:nodeId` 与 `DELETE /api/nodes/:nodeId`

**Files:**
- Modify: `backend/src/modules/nodes/node.service.ts`
- Modify: `backend/src/modules/nodes/node.routes.ts`
- Modify: `backend/src/modules/nodes/__tests__/node.routes.test.ts`

**Step 1：测试**

```ts
it('expert 可更新节点', async () => {
  const r = await request(app).put(`/api/nodes/${nodeId}`)
    .set('Authorization', `Bearer ${expertToken}`)
    .send({ description: '改后描述' });
  expect(r.status).toBe(200);
  expect(r.body.description).toBe('改后描述');
});
it('operator 删除返回 403', async () => {
  const r = await request(app).delete(`/api/nodes/${nodeId}`)
    .set('Authorization', `Bearer ${operatorToken}`);
  expect(r.status).toBe(403);
});
```

**Step 2：service**

```ts
async update(node_id: string, patch: Partial<Node>) {
  const rows = await runQuery<{ n: any }>(
    `MATCH (n:Node {node_id: $node_id})
     SET n += $patch, n.updated_at = datetime()
     RETURN n { .* } AS n`,
    { node_id, patch },
  );
  return rows[0]?.n ?? null;
},
async remove(node_id: string) {
  await runQuery(`MATCH (n:Node {node_id: $node_id}) DETACH DELETE n`, { node_id });
},
```

**Step 3：路由（含 RBAC）**

```ts
nodeRouter.put('/nodes/:nodeId', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const updated = await NodeService.update(req.params.nodeId, req.body);
    if (!updated) return res.status(404).json({ error: 'node not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

nodeRouter.delete('/nodes/:nodeId', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try { await NodeService.remove(req.params.nodeId); res.status(204).end(); } catch (e) { next(e); }
});
```

**Step 4：跑测试通过 + Commit**

```powershell
git commit -m "feat(agent-b): update/delete node with rbac"
```

---

## Task 10：`POST /api/nodes/batch-approve`

**Files:**
- Modify: `backend/src/modules/nodes/node.service.ts`
- Modify: `backend/src/modules/nodes/node.routes.ts`

**Step 1：测试**

```ts
it('批量 approve 后所有节点 status=approved', async () => {
  const r = await request(app).post('/api/nodes/batch-approve')
    .set('Authorization', `Bearer ${expertToken}`)
    .send({ node_ids: [n1, n2] });
  expect(r.status).toBe(200);
  expect(r.body.updated).toBe(2);
});
```

**Step 2：service**

```ts
async batchApprove(node_ids: string[]) {
  if (node_ids.length === 0) return { updated: 0 };
  const rows = await runQuery<{ updated: number }>(
    `UNWIND $node_ids AS nid
     MATCH (n:Node {node_id: nid})
     SET n.status = 'approved', n.updated_at = datetime()
     RETURN count(n) AS updated`,
    { node_ids },
  );
  return { updated: Number(rows[0]?.updated ?? 0) };
},
```

**Step 3：路由 + Commit**

```ts
const BatchApproveBody = z.object({ node_ids: z.array(z.string()).min(1) });
nodeRouter.post('/nodes/batch-approve', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const b = BatchApproveBody.parse(req.body);
    res.json(await NodeService.batchApprove(b.node_ids));
  } catch (e) { next(e); }
});
```

```powershell
git commit -m "feat(agent-b): batch approve nodes"
```

---

## Task 11：`RelationService` 与 `POST /api/graphs/:id/relations`

**Files:**
- Create: `backend/src/modules/relations/relation.service.ts`
- Create: `backend/src/modules/relations/relation.routes.ts`

**Step 1：DTO（复用 Agent-F schema）**

```ts
import { Relation, RelationType, NodeSource } from '@mkg/shared';
// 创建时不需要 relation_id / created_at
export const RelationCreateInput = Relation.omit({ relation_id: true, status: true, created_at: true });
export type RelationCreateInput = z.infer<typeof RelationCreateInput>;
```

**Step 2：实现（关系类型白名单 + 防注入）**

```ts
async create(graph_id: string, input: RelationCreateInput) {
  // RelationType 已是 zod enum，parse 通过即安全；再次 .parse 防止字符串绕过
  const relType = RelationType.parse(input.relation_type);
  const cypher = `
    MATCH (a:Node {node_id: $source_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
    MATCH (b:Node {node_id: $target_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
    CREATE (a)-[r:${relType} $props]->(b)
    RETURN r { .* } AS r, id(r) AS rid
  `;
  const props = {
    description: input.description ?? null,
    confidence: input.confidence ?? 1,
    source: input.source ?? 'manual',
    ai_job_id: input.ai_job_id ?? null,
    created_at: new Date().toISOString(),
  };
  const rows = await runQuery(cypher, {
    graph_id, source_id: input.source_id, target_id: input.target_id, props,
  });
  if (rows.length === 0) throw new Error('两端节点必须都属于该图谱');
  return {
    ...rows[0].r,
    relation_id: String(rows[0].rid),
    relation_type: relType,
    source_id: input.source_id,
    target_id: input.target_id,
  };
},
```

**Step 3：路由（RBAC）**

```ts
relationRouter.post('/graphs/:id/relations', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const body = RelationCreateInput.parse(req.body);
    res.json(await RelationService.create(req.params.id, body));
  } catch (e) { next(e); }
});
```

**Step 4：测试通过 + Commit**

```powershell
git commit -m "feat(agent-b): create relation with rbac and type whitelist"
```

---

## Task 12：`GET /api/graphs/:id/relations` 列表

**Files:**
- Modify: `relation.service.ts`、`relation.routes.ts`

**Step 1：测试**：插 2 个节点 + 1 条 PREREQUISITE_OF，断言列表长度。

**Step 2：实现**

```ts
async listByGraph(graph_id: string) {
  const rows = await runQuery<{ r: any; type: string; sid: string; tid: string; rid: number }>(
    `MATCH (a:Node)-[r]->(b:Node)
     WHERE (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
       AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
       AND type(r) <> 'BELONGS_TO_GRAPH'
     RETURN r { .* } AS r, type(r) AS type, a.node_id AS sid, b.node_id AS tid, id(r) AS rid`,
    { graph_id },
  );
  return rows.map((x) => ({
    ...x.r,
    relation_id: String(x.rid),
    relation_type: x.type,
    source_id: x.sid,
    target_id: x.tid,
  }));
},
```

**Step 3：路由 + Commit**

```ts
relationRouter.get('/graphs/:id/relations', requireAuth, async (req, res, next) => {
  try { res.json(await RelationService.listByGraph(req.params.id)); } catch (e) { next(e); }
});
```

```powershell
git commit -m "feat(agent-b): list relations of a graph"
```

---

## Task 13：`PUT /api/relations/:relationId` 与 `DELETE /api/relations/:relationId`

> 路径参数与设计文档 §5.3 一致，统一为 `:relationId`。Neo4j 关系无 `node_id`，使用 `id(r)` 字符串化作为 `relation_id`。

**Files:**
- Modify: `relation.service.ts`、`relation.routes.ts`

**Step 1：测试**：先 create 拿 relation_id；operator put 应 403；admin update description 应 200；admin delete 后 list 长度 -1。

**Step 2：service**

```ts
async update(relation_id: string, patch: Partial<Relation>) {
  const rid = Number(relation_id);
  if (!Number.isFinite(rid)) throw new Error('invalid relation_id');
  // 不允许通过 patch 改类型 / 端点；这两项需删除重建
  delete patch.relation_type;
  delete patch.source_id;
  delete patch.target_id;
  const rows = await runQuery<{ r: any }>(
    `MATCH ()-[r]->() WHERE id(r) = $rid
     SET r += $patch, r.updated_at = datetime()
     RETURN r { .* } AS r`,
    { rid, patch },
  );
  return rows[0]?.r ?? null;
},
async remove(relation_id: string) {
  const rid = Number(relation_id);
  if (!Number.isFinite(rid)) throw new Error('invalid relation_id');
  await runQuery(`MATCH ()-[r]->() WHERE id(r) = $rid DELETE r`, { rid });
},
```

**Step 3：路由（RBAC）**

```ts
relationRouter.put('/relations/:relationId', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const updated = await RelationService.update(req.params.relationId, req.body);
    if (!updated) return res.status(404).json({ error: 'relation not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

relationRouter.delete('/relations/:relationId', requireAuth, requireRole('admin', 'expert'), async (req, res, next) => {
  try { await RelationService.remove(req.params.relationId); res.status(204).end(); } catch (e) { next(e); }
});
```

**Step 4：测试通过 + Commit**

```powershell
git commit -m "feat(agent-b): update/delete relation with rbac"
```

---

## Task 14：`POST /api/graphs/:id/export`（导出 JSON）

**输出格式（与设计文档 §3.1 对齐）：**

```json
{
  "graph": { "graph_id": "...", "graph_name": "...", ... },
  "nodes": [ { "node_id": "...", "node_type": "...", ... } ],
  "relations": [ { "source_id": "...", "target_id": "...", "relation_type": "..." } ]
}
```

**Cypher：复用 list nodes / list relations。**

**Step 1：测试**

```ts
it('导出 JSON 包含完整图结构', async () => {
  // 先建一个图谱 + 2 节点 + 1 关系
  const json = await GraphService.exportJson(graph_id);
  expect(json.graph.graph_id).toBe(graph_id);
  expect(json.nodes.length).toBe(2);
  expect(json.relations.length).toBe(1);
});
```

**Step 2：路由响应头**

```ts
graphRouter.post('/:id/export', requireAuth, async (req, res, next) => {
  try {
    const data = await GraphService.exportJson(req.params.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="graph-${req.params.id}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) { next(e); }
});
```

**Step 3：Commit**

```powershell
git commit -m "feat(agent-b): export graph as json"
```

---

## Task 15：合并/批量写入辅助（供 Agent-C 使用）

**Files:**
- Create: `backend/src/services/neo4j/bulk.ts`

**目标：** 给 Agent-C 一个 `bulkUpsert(graph_id, nodes[], relations[])` 接口，用单事务批量写入 AI 生成结果，且节点状态默认 `candidate`。

**Cypher（节点）：**

```cypher
UNWIND $nodes AS node
MERGE (n:Node {node_id: node.node_id})
ON CREATE SET n = node, n.created_at = datetime(), n.status = coalesce(node.status, 'candidate')
ON MATCH  SET n += node, n.updated_at = datetime()
WITH n
MATCH (g:Graph {graph_id: $graph_id})
MERGE (n)-[:BELONGS_TO_GRAPH]->(g)
RETURN count(n) AS upserted
```

**Cypher（关系）：**

由于关系类型不能是参数，使用 `apoc.merge.relationship` 或在 service 层按 `relation_type` 分组多次执行。**MVP 阶段不依赖 APOC**，分组循环执行：

```ts
for (const [relType, items] of groupBy(relations, 'relation_type')) {
  await runQuery(`
    UNWIND $items AS rel
    MATCH (a:Node {node_id: rel.source_id})
    MATCH (b:Node {node_id: rel.target_id})
    MERGE (a)-[r:${relType}]->(b)
    ON CREATE SET r = rel, r.created_at = datetime()
    ON MATCH  SET r += rel, r.updated_at = datetime()
  `, { items });
}
```

`relType` 必须先用 `RelationType.parse(relType)` 校验，避免 Cypher 注入。

**Step：测试 → 实现 → Commit**

```powershell
git commit -m "feat(agent-b): bulk upsert helper for ai pipeline"
```

---

## Task 15a：AI 流水线专用批量接口（供 Agent-C 调用）

> 这是 Agent-C 的硬依赖。Agent-C `aiService.generate` / `approve` / `reject` 都通过 `ai_job_id` 来定位本次生成产生的 candidate 节点 / 关系。

**Files:**
- Create: `backend/src/modules/nodes/node.service.batch.ts`
- Create: `backend/src/modules/relations/relation.service.batch.ts`
- Create: `backend/src/services/neo4j/__tests__/batch.test.ts`
- Modify: `backend/src/scripts/neo4j-init.ts`（增加 `node_ai_job_idx` 索引）

**Step 1：增加索引**

在 `neo4j-init.ts` 的 CONSTRAINTS 数组追加：

```ts
'CREATE INDEX node_ai_job_idx IF NOT EXISTS FOR (n:Node) ON (n.ai_job_id)',
```

跑 `npm -w backend run neo4j:init` 确认无错。

**Step 2：写测试 `batch.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { NodeService } from '../../../modules/nodes/node.service';
import { GraphService } from '../../../modules/graphs/graph.service';

let graphId: string;
const jobId = 'job-test-' + Date.now();

beforeAll(async () => {
  const g = await GraphService.create({ graph_name: 'batch-test', graph_type: 'course' }, 'tester');
  graphId = g.graph_id;
});

describe('NodeService batch APIs', () => {
  it('createBatch 一次写入 N 个 candidate 节点并标 ai_job_id', async () => {
    const nodes = [
      { node_type: 'knowledge_point', name: 'A', knowledge_type: '概念类' },
      { node_type: 'knowledge_point', name: 'B', knowledge_type: '概念类' },
    ];
    const created = await NodeService.createBatch(graphId, nodes, { ai_job_id: jobId, status: 'candidate' });
    expect(created).toHaveLength(2);
    expect(created.every((n) => n.status === 'candidate' && n.ai_job_id === jobId)).toBe(true);
  });
  it('bulkUpdateStatusByJob 把整批 candidate 改为 approved', async () => {
    const n = await NodeService.bulkUpdateStatusByJob(jobId, 'approved');
    expect(n).toBeGreaterThanOrEqual(2);
  });
  it('bulkUpdateStatusByIds 仅改指定节点', async () => {
    const list = await NodeService.listByGraph(graphId, {});
    const ids = list.slice(0, 1).map((x) => x.node_id);
    const n = await NodeService.bulkUpdateStatusByIds(ids, 'rejected');
    expect(n).toBe(1);
  });
  it('bulkDeleteByJob 删除整批未通过的 candidate', async () => {
    const job2 = 'job-test-' + Date.now();
    await NodeService.createBatch(graphId, [{ node_type: 'term', name: 'X', standard_term: 'X' }], { ai_job_id: job2, status: 'candidate' });
    const n = await NodeService.bulkDeleteByJob(job2);
    expect(n).toBe(1);
  });
});
```

**Step 3：实现 `node.service.batch.ts`，并合并到 `NodeService` 命名空间**

在 `backend/src/modules/nodes/node.service.ts` 中追加（同一 namespace 下导出）：

```ts
import { runQuery } from '../../lib/neo4j';
import { generateNodeId } from '@mkg/shared';
import type { Node, NodeStatus } from '@mkg/shared';

export interface BatchOptions {
  ai_job_id?: string;
  status?: NodeStatus;
  source?: 'manual' | 'ai_generated' | 'imported';
}

export const NodeServiceBatch = {
  async createBatch(
    graphId: string,
    inputs: Array<Partial<Node> & { node_type: Node['node_type']; name: string }>,
    opts: BatchOptions = {},
  ) {
    const nodes = inputs.map((n) => ({
      ...n,
      node_id: n.node_id ?? generateNodeId(n.node_type),
      status: opts.status ?? n.status ?? 'candidate',
      source: opts.source ?? n.source ?? 'ai_generated',
      ai_job_id: opts.ai_job_id ?? n.ai_job_id,
      created_at: new Date().toISOString(),
    }));
    await runQuery(
      `
      UNWIND $nodes AS node
      MERGE (n:Node {node_id: node.node_id})
      ON CREATE SET n = node
      ON MATCH SET n += node, n.updated_at = datetime()
      WITH n
      MATCH (g:Graph {graph_id: $graphId})
      MERGE (n)-[:BELONGS_TO_GRAPH]->(g)
    `,
      { nodes, graphId },
    );
    return nodes;
  },

  async bulkUpdateStatusByJob(graphId: string, aiJobId: string, status: NodeStatus): Promise<number> {
    const rows = await runQuery<{ updated: number }>(
      `MATCH (n:Node { ai_job_id: $aiJobId })-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET n.status = $status, n.updated_at = datetime()
       RETURN count(n) AS updated`,
      { graphId, aiJobId, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkUpdateStatusByIds(graphId: string, nodeIds: string[], status: NodeStatus): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const rows = await runQuery<{ updated: number }>(
      `UNWIND $ids AS id
       MATCH (n:Node { node_id: id })-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET n.status = $status, n.updated_at = datetime()
       RETURN count(n) AS updated`,
      { graphId, ids: nodeIds, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (n:Node { ai_job_id: $aiJobId, status: 'candidate' })-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       DETACH DELETE n
       RETURN count(n) AS deleted`,
      { graphId, aiJobId },
    );
    return Number(rows[0]?.deleted ?? 0);
  },

  async listByAiJob(graphId: string, aiJobId: string): Promise<Node[]> {
    const rows = await runQuery<{ n: any }>(
      `MATCH (n:Node { ai_job_id: $aiJobId })-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       RETURN n { .* } AS n`,
      { graphId, aiJobId },
    );
    return rows.map((x) => x.n);
  },
};

// 把批量方法合并到 NodeService 上
export const NodeService = Object.assign({}, NodeServiceCrud, NodeServiceBatch);
```

> 说明：`NodeServiceCrud` 是 Task 7-9 已有的单条方法集合；本 Task 把两者合并到同名 `NodeService`，下游可直接 `NodeService.create / createBatch / bulkUpdateStatusByJob / ...`。

**Step 4：实现 `relation.service.batch.ts`（同上但走关系）**

```ts
export const RelationServiceBatch = {
  async createBatch(graphId: string, inputs: Array<Partial<Relation> & { source_id: string; target_id: string; relation_type: Relation['relation_type'] }>, opts: BatchOptions = {}) {
    // 按 relation_type 分组（Cypher 关系类型不能用参数）
    const groups = new Map<string, typeof inputs>();
    for (const r of inputs) {
      RelationType.parse(r.relation_type); // 防注入
      const arr = groups.get(r.relation_type) ?? [];
      arr.push(r);
      groups.set(r.relation_type, arr);
    }
    let total = 0;
    for (const [relType, items] of groups) {
      const enriched = items.map((r) => ({
        ...r,
        status: opts.status ?? r.status ?? 'candidate',
        source: opts.source ?? r.source ?? 'ai_generated',
        ai_job_id: opts.ai_job_id ?? r.ai_job_id,
        created_at: new Date().toISOString(),
      }));
      const rows = await runQuery<{ n: number }>(
        `UNWIND $items AS rel
         MATCH (a:Node {node_id: rel.source_id})
         MATCH (b:Node {node_id: rel.target_id})
         MERGE (a)-[r:${relType}]->(b)
         ON CREATE SET r = rel
         ON MATCH SET r += rel, r.updated_at = datetime()
         RETURN count(r) AS n`,
        { items: enriched },
      );
      total += Number(rows[0]?.n ?? 0);
    }
    return total;
  },

  async bulkUpdateStatusByJob(graphId: string, aiJobId: string, status: NodeStatus): Promise<number> {
    const rows = await runQuery<{ updated: number }>(
      `MATCH (a:Node)-[r { ai_job_id: $aiJobId }]->(b:Node)
       WHERE (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET r.status = $status, r.updated_at = datetime()
       RETURN count(r) AS updated`,
      { graphId, aiJobId, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkUpdateStatusByIds(graphId: string, relationIds: string[], status: NodeStatus): Promise<number> {
    if (relationIds.length === 0) return 0;
    const ids = relationIds.map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return 0;
    const rows = await runQuery<{ updated: number }>(
      `MATCH (a:Node)-[r]->(b:Node)
       WHERE id(r) IN $ids
         AND (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET r.status = $status, r.updated_at = datetime()
       RETURN count(r) AS updated`,
      { graphId, ids, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (a:Node)-[r { ai_job_id: $aiJobId, status: 'candidate' }]->(b:Node)
       WHERE (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       DELETE r
       RETURN count(r) AS deleted`,
      { graphId, aiJobId },
    );
    return Number(rows[0]?.deleted ?? 0);
  },

  async listByAiJob(graphId: string, aiJobId: string): Promise<Relation[]> {
    const rows = await runQuery<{ r: any; type: string; sid: string; tid: string; rid: number }>(
      `MATCH (a:Node)-[r { ai_job_id: $aiJobId }]->(b:Node)
       WHERE (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       RETURN r { .* } AS r, type(r) AS type, a.node_id AS sid, b.node_id AS tid, id(r) AS rid`,
      { graphId, aiJobId },
    );
    return rows.map((x) => ({
      ...x.r,
      relation_id: String(x.rid),
      source_id: x.sid,
      target_id: x.tid,
      relation_type: x.type as any,
    }));
  },
};

export const RelationService = Object.assign({}, RelationServiceCrud, RelationServiceBatch);
```

**Step 5：跑测试通过**

Run: `npm -w backend test src/services/neo4j/__tests__/batch.test.ts`
Expected: 4 PASS。

**Step 6：Commit**

```powershell
git add backend/src/modules/nodes backend/src/modules/relations backend/src/services/neo4j backend/src/scripts/neo4j-init.ts
git commit -m "feat(agent-b): batch APIs + ai_job_id index for ai pipeline"
```

---

## Task 16：错误统一与 OpenAPI 注册

- 所有路由抛出的 `ZodError` 由 Agent-A 的 `errorHandler` 转 400 + `details`。
- OpenAPI 单一真理源在 Agent-F（`shared/src/openapi/registry.ts` 生成 `backend/openapi.yaml`）。本 Agent 在 `shared/src/openapi/registry.ts` 内为 graphs / nodes / relations / batch-approve / export 路由调用 `registry.registerPath(...)`，与 Agent-F 协作维护 yaml。

示例（写入 `shared/src/openapi/registry.ts` 内）：

```ts
import { registry } from './registry';
import { Graph, GraphCreateInput } from '../schemas/graph';

registry.registerPath({
  method: 'post',
  path: '/api/graphs',
  tags: ['graph'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: GraphCreateInput } } } },
  responses: { 201: { description: 'created', content: { 'application/json': { schema: Graph } } } },
});
```

**Commit：**

```powershell
git commit -m "docs(agent-b): register openapi paths for graph endpoints"
```

---

## Task 17：本 Agent 自交付的端到端 smoke 脚本

**Files:**
- Create: `backend/src/scripts/smoke-graph.ts`
- Create: `backend/src/scripts/__tests__/smoke-graph.test.ts`
- Modify: `backend/package.json`（加 `"smoke:graph": "tsx src/scripts/smoke-graph.ts"`）

**目的：** 在交给 Agent-H 之前，本 Agent 必须自证「建图 → 加节点 → 加关系 → 列表 → 导出」全链路通。Agent-H 后续的 e2e 用例只是包装本脚本的 HTTP 层断言。

**Step 1：写脚本 `smoke-graph.ts`（直接调 Service 层，不走 HTTP）**

```ts
import { GraphService } from '../modules/graphs/graph.service';
import { NodeService } from '../modules/nodes/node.service';
import { RelationService } from '../modules/relations/relation.service';
import { closeDriver } from '../lib/neo4j';

async function main() {
  console.log('1) 建图');
  const g = await GraphService.create({
    graph_name: 'smoke-' + Date.now(),
    graph_type: 'course',
    subject: '护理学',
    course_name: '基础护理学',
    created_by: '00000000-0000-0000-0000-000000000001',
  });

  console.log('2) 加节点');
  const a = await NodeService.create(g.graph_id, { node_type: 'knowledge_point', name: '心率监测' } as any);
  const b = await NodeService.create(g.graph_id, { node_type: 'knowledge_point', name: '血压测量' } as any);

  console.log('3) 加关系');
  await RelationService.create(g.graph_id, {
    source_id: a.node_id,
    target_id: b.node_id,
    relation_type: 'RELATED_TO',
  } as any);

  console.log('4) 列表');
  const list = await NodeService.list(g.graph_id, { skip: 0, limit: 50 });
  if (list.total !== 2) throw new Error(`expected 2 nodes, got ${list.total}`);

  console.log('5) 导出');
  const exported = await GraphService.exportToJson(g.graph_id);
  if (!exported.graph || exported.nodes.length !== 2 || exported.relations.length !== 1) {
    throw new Error('export shape mismatch');
  }

  console.log('6) 清理');
  await GraphService.remove(g.graph_id);
  console.log('SMOKE PASS', g.graph_id);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => closeDriver());
```

**Step 2：写一条 vitest 包装本脚本（保证 CI 也跑）**

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('smoke graph e2e', () => {
  it('一键 smoke 脚本退出码为 0', () => {
    const out = execSync('npx tsx src/scripts/smoke-graph.ts', { encoding: 'utf-8' });
    expect(out).toContain('SMOKE PASS');
  }, 60_000);
});
```

**Step 3：Commit**

```powershell
npm -w backend run smoke:graph
git add backend/src/scripts/smoke-graph.ts backend/src/scripts/__tests__/smoke-graph.test.ts backend/package.json
git commit -m "test(agent-b): self-served smoke for graph/node/relation/export"
```

**DoD：**
- ✅ `npm -w backend run smoke:graph` 退出码 0，输出 `SMOKE PASS`
- ✅ 测试库 `mkgtest` 在脚本结束后无残留 graph
- ✅ Agent-H 可直接复用同一组步骤改写 supertest 版本

> Agent-H 接管后只需在 `backend/src/__tests__/integration/graph.test.ts` 里把上述步骤换成 `request(app).post(...)` 等 HTTP 调用。

---

## Agent-B 完工标志

- [ ] `npm -w backend run neo4j:init` 一次成功
- [ ] 单测全部通过（≥ 20 用例覆盖增删改查）
- [ ] Swagger UI 可看到 `/api/graphs`、`/api/nodes`、`/api/relations` 全套接口
- [ ] 导出 JSON 与设计文档结构一致
- [ ] `bulkUpsert` 接口可被 Agent-C 直接调用
- [ ] 所有 Cypher 都是参数化，无字符串拼接

---

## 与其他 Agent 的接口

| 方向 | 接口 | 用途 |
|---|---|---|
| Agent-A → Agent-B | `requireAuth`, `requireRole` 中间件 | 路由保护 |
| Agent-B → Agent-C | `bulkUpsert(graph_id, nodes, relations)` | AI 生成结果落库 |
| Agent-B → Agent-D/E | OpenAPI 契约 + `@mkg/shared` 类型 | 前端调用 |
| Agent-B → Agent-H | supertest 冒烟用例覆盖 | E2E 起点 |
