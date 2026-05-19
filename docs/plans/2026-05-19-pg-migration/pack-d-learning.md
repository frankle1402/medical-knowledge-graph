# Pack D — 教学查询 API（学习路径 / 知识缺口 / 同义合并候选）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 在 PG 后端基础上新增 3 个教学场景查询 API：学习路径推荐、知识缺口检测、同义合并候选。前两者用 Postgres 递归 CTE，第三个用 Pack C 的 pgvector 列。

**Architecture:** 新模块 `backend/src/modules/learning/`，service + routes，service 内全部用 `prisma.$queryRaw` 执行递归 CTE；同义候选直接复用 nodes.embedding 列。

**Tech Stack:** Postgres recursive CTE · Prisma raw query · pgvector cosine ops · zod 校验 · vitest

---

## 工作分支

`feature/pg-migration-pack-d-learning`

## 输出目录（仅本 Pack 可写）

- `backend/src/modules/learning/learning.service.ts`
- `backend/src/modules/learning/learning.routes.ts`
- `backend/src/modules/learning/__tests__/learning.service.test.ts`
- `backend/src/modules/learning/__tests__/learning.routes.test.ts`
- `backend/src/index.ts`（mount 一处 — 需协调）

## 边界（不可动）

- `backend/src/modules/{graphs,nodes,relations,search}/`
- `backend/src/services/embedding/`（Pack C 范围，本 pack 仅消费其结果）
- 前端代码
- Prisma schema

## 关键依赖

- ✅ Pack A（schema 已就绪）
- ✅ Pack B（service 走 PG 路径）
- ⛓ 同义候选依赖 Pack C 的 `nodes.embedding` 列被填充 — 但 API 实现本身不依赖 Pack C 完成，只要 `embedding IS NOT NULL` 就能工作

---

## API 契约（前端 Pack E 依赖此契约）

### GET /api/nodes/:node_id/learning-path

**Query:** `depth` int, optional, default 5, max 10

**Response 200:**
```json
{
  "target": { "node_id": "KP_HEART_FAIL", "name": "心力衰竭" },
  "path": [
    { "node_id": "KP_HEART_RATE", "name": "心率", "depth": 3, "via": "前置" },
    { "node_id": "KP_HEART_RHYTHM", "name": "心律", "depth": 2, "via": "前置" },
    { "node_id": "KP_ARRHYTHMIA", "name": "心律失常", "depth": 1, "via": "前置" }
  ]
}
```
- 沿 `relation_type='前置'` 反向遍历（A 前置 B 表示学 B 前要学 A）
- `depth` 表示距离目标节点的跳数（1 = 直接前置）
- 拓扑排序：远的在前，近的在后

**错误**：404 节点不存在；400 depth 超限

### POST /api/graphs/:graph_id/knowledge-gap

**Request:**
```json
{
  "mastered": ["KP_001", "KP_002"],
  "targets": ["KP_HEART_FAIL"]
}
```

**Response 200:**
```json
{
  "gaps": [
    { "node_id": "KP_HEART_RHYTHM", "name": "心律", "blocking": ["KP_HEART_FAIL"] }
  ]
}
```
- 算法：对每个 target 反向 BFS 收集所有前置节点，去掉 mastered 集合，剩下的就是缺口
- `blocking` 字段：哪些 target 因为缺这个节点而学不了

### GET /api/graphs/:graph_id/synonym-candidates

**Query:** `threshold` float, optional, default 0.92, range [0.85, 0.99]

**Response 200:**
```json
{
  "candidates": [
    {
      "a": { "node_id": "KP_001", "name": "心率失常" },
      "b": { "node_id": "KP_009", "name": "心律不齐" },
      "score": 0.96
    }
  ]
}
```
- 同图内、不同节点、cosine 相似度 ≥ threshold 的 pair
- 去重：(a, b) 与 (b, a) 算同一对，按 node_id 字典序排
- 限制：返回 top 50（防爆炸）

**错误**：400 threshold 超范围；503 若仍有节点未嵌入（提示先跑 backfill）

---

## Task 1：学习路径 API（递归 CTE）

**Files:**
- Create: `backend/src/modules/learning/learning.service.ts`（开头）
- Create: `backend/src/modules/learning/__tests__/learning.service.test.ts`

**Step 1：先写 service 接口**

```ts
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';

export const LearningPathQuery = z.object({
  depth: z.coerce.number().int().min(1).max(10).default(5),
});
export type LearningPathQueryT = z.infer<typeof LearningPathQuery>;

export interface LearningPathStep {
  node_id: string;
  name: string;
  depth: number;
  via: string;
}
export interface LearningPath {
  target: { node_id: string; name: string };
  path: LearningPathStep[];
}

export const LearningService = {
  async learningPath(node_id: string, q: LearningPathQueryT): Promise<LearningPath | null> {
    const target = await getPrisma().node.findUnique({
      where: { node_id },
      select: { node_id: true, name: true },
    });
    if (!target) return null;

    // Recursive CTE: walk back along '前置' relations
    const rows = await getPrisma().$queryRaw<Array<LearningPathStep>>`
      WITH RECURSIVE prereqs AS (
        -- direct prereqs (depth 1)
        SELECT n.node_id, n.name, 1 AS depth, r.relation_type AS via
        FROM relations r
        JOIN nodes n ON n.node_id = r.source_id
        WHERE r.target_id = ${node_id}
          AND r.relation_type = '前置'
          AND r.status = 'approved'

        UNION

        SELECT n.node_id, n.name, p.depth + 1 AS depth, r.relation_type AS via
        FROM prereqs p
        JOIN relations r ON r.target_id = p.node_id
        JOIN nodes n ON n.node_id = r.source_id
        WHERE r.relation_type = '前置'
          AND r.status = 'approved'
          AND p.depth < ${q.depth}
      )
      SELECT DISTINCT ON (node_id) node_id, name, depth, via
      FROM prereqs
      ORDER BY node_id, depth ASC
    `;

    // Sort: deepest first (foundational concepts come first in study order)
    rows.sort((a, b) => b.depth - a.depth);

    return { target, path: rows };
  },
};
```

**Step 2：写测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getPrisma } from '../../../lib/prisma';
import { LearningService } from '../learning.service';

describe('LearningService.learningPath', () => {
  beforeEach(async () => {
    const p = getPrisma();
    await p.relation.deleteMany();
    await p.node.deleteMany();
    await p.graph.deleteMany();
    await p.graph.create({ data: { graph_id: 'G1', graph_name: 'test', graph_type: 'curriculum' } });
    // Build chain: A → B → C → D (A precedes B precedes C precedes D)
    for (const id of ['A', 'B', 'C', 'D']) {
      await p.node.create({ data: { node_id: id, graph_id: 'G1', node_type: 'knowledge_point', name: id } });
    }
    for (const [s, t] of [['A','B'],['B','C'],['C','D']]) {
      await p.relation.create({ data: { graph_id: 'G1', source_id: s, target_id: t, relation_type: '前置' } });
    }
  });

  it('returns full chain for D up to depth 5', async () => {
    const r = await LearningService.learningPath('D', { depth: 5 });
    expect(r?.path.map(s => s.node_id)).toEqual(['A', 'B', 'C']);
    // A is deepest (depth 3), C is closest (depth 1)
    expect(r?.path[0]?.depth).toBe(3);
    expect(r?.path[2]?.depth).toBe(1);
  });

  it('respects depth limit', async () => {
    const r = await LearningService.learningPath('D', { depth: 1 });
    expect(r?.path.map(s => s.node_id)).toEqual(['C']);
  });

  it('returns null for unknown node', async () => {
    expect(await LearningService.learningPath('NOPE', { depth: 5 })).toBeNull();
  });
});
```

**Commit:** `feat(learning): learning-path API with recursive CTE`

---

## Task 2：知识缺口 API

**Files:** 追加到 `learning.service.ts`

```ts
export const KnowledgeGapInput = z.object({
  mastered: z.array(z.string()).default([]),
  targets: z.array(z.string()).min(1),
});

export interface KnowledgeGapResult {
  gaps: Array<{ node_id: string; name: string; blocking: string[] }>;
}

async knowledgeGap(graph_id: string, input: z.infer<typeof KnowledgeGapInput>): Promise<KnowledgeGapResult> {
  // For each target, walk back along '前置' to collect ancestor set.
  // Then exclude mastered, group by node_id, aggregate which targets each blocks.
  const rows = await getPrisma().$queryRaw<Array<{ node_id: string; name: string; target_id: string }>>`
    WITH RECURSIVE prereqs AS (
      SELECT r.target_id AS root, n.node_id, n.name, 1 AS depth
      FROM relations r
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.target_id = ANY(${input.targets}::text[])
        AND r.relation_type = '前置'
        AND r.status = 'approved'

      UNION

      SELECT p.root, n.node_id, n.name, p.depth + 1
      FROM prereqs p
      JOIN relations r ON r.target_id = p.node_id
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.relation_type = '前置'
        AND r.status = 'approved'
        AND p.depth < 10
    )
    SELECT DISTINCT node_id, name, root AS target_id FROM prereqs
    WHERE node_id <> ALL(${input.mastered.length > 0 ? input.mastered : ['__never__']}::text[])
  `;

  // group by node_id
  const map = new Map<string, { node_id: string; name: string; blocking: Set<string> }>();
  for (const r of rows) {
    const e = map.get(r.node_id) ?? { node_id: r.node_id, name: r.name, blocking: new Set<string>() };
    e.blocking.add(r.target_id);
    map.set(r.node_id, e);
  }
  return {
    gaps: [...map.values()].map(e => ({ node_id: e.node_id, name: e.name, blocking: [...e.blocking].sort() })),
  };
},
```

**测试**：构造 A→B→C→D 链 + E→D，mastered=[A], targets=[D] → gaps 应含 B/C/E。

**Commit:** `feat(learning): knowledge-gap API`

---

## Task 3：同义合并候选

**Files:** 追加到 `learning.service.ts`

```ts
export const SynonymQuery = z.object({
  threshold: z.coerce.number().min(0.85).max(0.99).default(0.92),
});

export interface SynonymCandidate {
  a: { node_id: string; name: string };
  b: { node_id: string; name: string };
  score: number;
}

async synonymCandidates(graph_id: string, q: z.infer<typeof SynonymQuery>): Promise<SynonymCandidate[]> {
  const cosineThreshold = 1 - q.threshold;  // pgvector <=> returns distance, smaller = more similar
  const rows = await getPrisma().$queryRaw<Array<{
    a_id: string; a_name: string; b_id: string; b_name: string; dist: number;
  }>>`
    SELECT
      n1.node_id AS a_id, n1.name AS a_name,
      n2.node_id AS b_id, n2.name AS b_name,
      (n1.embedding <=> n2.embedding) AS dist
    FROM nodes n1
    JOIN nodes n2 ON n1.graph_id = n2.graph_id
                  AND n1.node_id < n2.node_id  -- canonical ordering, dedupes pairs
    WHERE n1.graph_id = ${graph_id}
      AND n1.embedding IS NOT NULL
      AND n2.embedding IS NOT NULL
      AND (n1.embedding <=> n2.embedding) <= ${cosineThreshold}
    ORDER BY dist ASC
    LIMIT 50
  `;
  return rows.map(r => ({
    a: { node_id: r.a_id, name: r.a_name },
    b: { node_id: r.b_id, name: r.b_name },
    score: 1 - r.dist,
  }));
},
```

**测试**：mock embedding 列写入两个相近向量 + 一个远向量，验证 threshold 过滤正确。

**Commit:** `feat(learning): synonym-candidates API via pgvector`

---

## Task 4：路由 + mount

**Files:**
- Create: `backend/src/modules/learning/learning.routes.ts`
- Modify: `backend/src/index.ts`（一行 `app.use('/api/learning', learningRoutes)` — 跟其他路由放一起）

```ts
import { Router } from 'express';
import { LearningService, LearningPathQuery, KnowledgeGapInput, SynonymQuery } from './learning.service';
import { requireAuth } from '../../middleware/auth';

export const learningRoutes = Router();

learningRoutes.get('/nodes/:node_id/learning-path', requireAuth, async (req, res, next) => {
  try {
    const q = LearningPathQuery.parse(req.query);
    const r = await LearningService.learningPath(req.params.node_id, q);
    if (!r) return res.status(404).json({ error: 'node not found' });
    res.json(r);
  } catch (e) { next(e); }
});

learningRoutes.post('/graphs/:graph_id/knowledge-gap', requireAuth, async (req, res, next) => {
  try {
    const body = KnowledgeGapInput.parse(req.body);
    res.json(await LearningService.knowledgeGap(req.params.graph_id, body));
  } catch (e) { next(e); }
});

learningRoutes.get('/graphs/:graph_id/synonym-candidates', requireAuth, async (req, res, next) => {
  try {
    const q = SynonymQuery.parse(req.query);
    res.json({ candidates: await LearningService.synonymCandidates(req.params.graph_id, q) });
  } catch (e) { next(e); }
});
```

**注意 mount 路径冲突**：API 契约里写的是 `GET /api/nodes/...` 和 `POST /api/graphs/...`，与现有 `/api/nodes` `/api/graphs` 路由共享前缀。要么 mount 时重新分配前缀，要么把 path 写完整。建议 mount `app.use('/api', learningRoutes)`，把路径写在 router 里就好。

**测试**：用 supertest 打三个 endpoint，验证 200 + shape 对，401 未登录。

**Commit:** `feat(learning): mount learning routes`

---

## Verification

1. `npm -w backend test src/modules/learning` 全过
2. 跑 `migrate-from-neo4j` 装一个真实图谱（含"前置"关系），手动调三个 API 看返回合理
3. `npm run build` 通过

---

## 风险

- **递归 CTE 性能**：图谱小（< 1k 节点）下毫秒级；超过 10k 节点要加索引 `(target_id, relation_type)` — 已在 Pack A schema 的 `@@index([target_id])` 覆盖
- **空"前置"图**：如果图谱里完全没有 `relation_type='前置'`，learning-path 返回空数组（path: []），不是错误
- **同义候选结果数**：图谱大时 N² 比较成本高 — limit 50 + ivfflat 索引能控住；用户需求不大可以加 cache

---

## Commits 总数

约 4 个：path / gap / synonym / routes-mount。
