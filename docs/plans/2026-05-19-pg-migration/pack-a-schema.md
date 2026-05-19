# Pack A — Postgres Schema + 数据迁移脚本

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 Postgres（Prisma 已管 users/templates/ai_logs）上增加 `graphs` / `nodes` / `relations` 三张表，装好 pgvector 扩展并预留 `embedding` 列，实现一次性数据搬运脚本把 Neo4j 全量数据拷到 PG。

**Architecture:** 用 Prisma migration 加表（保留与现有用户表的可关联结构），用 raw SQL migration 装 pgvector + 加索引；搬运脚本走 Neo4j read → Prisma upsert 模式，幂等可重跑。

**Tech Stack:** Prisma 5.x · Postgres 15+ · pgvector 0.7 · neo4j-driver（仅在搬运脚本里使用）· vitest

---

## 工作分支

`feature/pg-migration-pack-a-schema`

## 输出目录（仅本 Pack 可写）

- `backend/prisma/schema.prisma`（增量加 model，不动既有 model）
- `backend/prisma/migrations/<ts>_add_graph_tables/`（Prisma 自动生成）
- `backend/prisma/migrations/<ts>_add_pgvector/`（手写 raw SQL）
- `backend/src/scripts/migrate-from-neo4j.ts`（新文件）
- `backend/src/scripts/__tests__/migrate-from-neo4j.test.ts`（新文件）
- `backend/.env.example`（如果有就更新 DATABASE_URL 注释，否则跳过）

## 边界（不可动）

- `backend/src/modules/**`（service 层属于 Pack B）
- `backend/src/lib/neo4j.ts`（保留）
- `backend/src/services/neo4j/`（保留）
- 既有 User / PromptTemplate / AiGenerationLog model
- 任何前端代码

## 关键依赖

- ✅ Postgres 已就绪（Prisma 已在用，schema.prisma 已存在）
- ✅ Neo4j 仍在跑（搬运脚本要从它读）
- ⛓ 必须先于 Pack B/C/D 完成

---

## Task 1：Prisma model 增量

**Files:**
- Modify: `backend/prisma/schema.prisma`（追加 3 个 model）

**Step 1：在 `schema.prisma` 末尾追加**

```prisma
model Graph {
  graph_id      String   @id @db.VarChar(50)
  graph_name    String   @db.VarChar(100)
  graph_type    String   @db.VarChar(40)
  subject       String?  @db.VarChar(50)
  course_name   String?  @db.VarChar(100)
  description   String?  @db.Text
  status        String   @default("active") @db.VarChar(20)
  created_by    String?  @db.VarChar(50)
  created_at    DateTime @default(now()) @db.Timestamptz
  updated_at    DateTime @updatedAt @db.Timestamptz

  nodes     Node[]
  relations Relation[]

  @@map("graphs")
}

model Node {
  node_id        String   @id @db.VarChar(80)
  graph_id       String   @db.VarChar(50)
  node_type      String   @db.VarChar(40)
  knowledge_type String?  @db.VarChar(40)
  name           String   @db.VarChar(200)
  description    String?  @db.Text
  status         String   @default("approved") @db.VarChar(20)
  source         String   @default("manual") @db.VarChar(20)
  confidence     Float    @default(1.0)
  tags           Json     @default("[]")
  ai_job_id      String?  @db.VarChar(50)
  // embedding vector(1536) — 在 _add_pgvector migration 里加
  created_at     DateTime @default(now()) @db.Timestamptz
  updated_at     DateTime @updatedAt @db.Timestamptz

  graph              Graph      @relation(fields: [graph_id], references: [graph_id], onDelete: Cascade)
  outgoing_relations Relation[] @relation("RelationSource")
  incoming_relations Relation[] @relation("RelationTarget")

  @@index([graph_id])
  @@index([graph_id, status])
  @@index([ai_job_id])
  @@map("nodes")
}

model Relation {
  relation_id   BigInt   @id @default(autoincrement())
  graph_id      String   @db.VarChar(50)
  source_id     String   @db.VarChar(80)
  target_id     String   @db.VarChar(80)
  relation_type String   @db.VarChar(40)
  status        String   @default("approved") @db.VarChar(20)
  confidence    Float    @default(1.0)
  description   String?  @db.Text
  ai_job_id     String?  @db.VarChar(50)
  created_at    DateTime @default(now()) @db.Timestamptz
  updated_at    DateTime @updatedAt @db.Timestamptz

  graph  Graph @relation(fields: [graph_id], references: [graph_id], onDelete: Cascade)
  source Node  @relation("RelationSource", fields: [source_id], references: [node_id], onDelete: Cascade)
  target Node  @relation("RelationTarget", fields: [target_id], references: [node_id], onDelete: Cascade)

  @@unique([source_id, target_id, relation_type], name: "relations_unique_edge")
  @@index([graph_id])
  @@index([source_id])
  @@index([target_id])
  @@map("relations")
}
```

**重要**：
- `Node.node_id` / `Graph.graph_id` 用 VarChar 而非 UUID — 与现有 Neo4j ID 生成器（`generateGraphId()`）保持兼容，搬运时无需改 ID
- `Relation.relation_id` 用 BIGSERIAL — 取代 Neo4j 内部 `id(r)`，前端反序列化用 `String(relation_id)` 即可
- `@@unique([source_id, target_id, relation_type])` 是 Neo4j MERGE 语义的等价表达（同一对节点 + 同一类型只能存在一条边）

**Step 2：跑 migration**

```powershell
cd backend
npx prisma migrate dev --name add_graph_tables
```

预期：生成 `backend/prisma/migrations/<ts>_add_graph_tables/migration.sql`。

**Step 3：手动检查生成的 SQL**

应包含 3 张表 + 7 个索引 + 1 个 unique constraint + 5 个 FK。如果 SQL 跟预期不符，调整 schema 重跑 `migrate dev`（reset 不要紧，反正现在没人用这三张表）。

**Step 4：验证**

```powershell
npx prisma generate
psql $env:DATABASE_URL -c "\d graphs"
psql $env:DATABASE_URL -c "\d nodes"
psql $env:DATABASE_URL -c "\d relations"
```

预期：3 张表存在。

**Commit:** `feat(db): add graphs/nodes/relations tables via Prisma`

---

## Task 2：pgvector 扩展 + embedding 列

**Files:**
- Create: `backend/prisma/migrations/<ts>_add_pgvector/migration.sql`（手写）
- Modify: `backend/prisma/schema.prisma`（加 `Unsupported("vector(1536)")` 列声明）

**Step 1：先手写 migration**

```powershell
cd backend
npx prisma migrate dev --create-only --name add_pgvector
```

会生成空目录，编辑 `migration.sql`：

```sql
-- pgvector extension + embedding column on nodes
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE nodes ADD COLUMN embedding vector(1536);

-- ivfflat index for cosine similarity. lists=100 is a sensible default for
-- up to ~1M rows; tune later if dataset grows.
-- See: https://github.com/pgvector/pgvector#indexing
CREATE INDEX nodes_embedding_idx ON nodes
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Step 2：在 schema.prisma 的 `Node` model 加列**

把 `// embedding vector(1536)` 注释那行替换成：

```prisma
  embedding      Unsupported("vector(1536)")?
```

Prisma 会承认这列存在但不暴露给 client（用 raw query 读写，由 Pack C 处理）。

**Step 3：apply migration**

```powershell
npx prisma migrate dev
```

预期：migration 应用成功，`SELECT extname FROM pg_extension WHERE extname='vector';` 返回 1 行。

**Commit:** `feat(db): add pgvector extension + embedding column on nodes`

---

## Task 3：从 Neo4j 搬数据到 PG 的脚本

**Files:**
- Create: `backend/src/scripts/migrate-from-neo4j.ts`
- Create: `backend/src/scripts/__tests__/migrate-from-neo4j.test.ts`

**Step 1：先写测试**

```ts
// backend/src/scripts/__tests__/migrate-from-neo4j.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { runQuery, closeDriver } from '../../lib/neo4j';
import { prisma } from '../../lib/prisma'; // 假设 Pack 已有 prisma client 单例
import { migrateFromNeo4j } from '../migrate-from-neo4j';

async function clearAll() {
  await runQuery('MATCH (n) DETACH DELETE n');
  await prisma.relation.deleteMany();
  await prisma.node.deleteMany();
  await prisma.graph.deleteMany();
}

describe('migrate-from-neo4j', () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await closeDriver();
    await prisma.$disconnect();
  });

  it('搬运 1 个空图谱', async () => {
    await runQuery(`CREATE (g:Graph {graph_id: 'G1', graph_name: '测试图', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})`);
    const stats = await migrateFromNeo4j();
    expect(stats.graphs).toBe(1);
    expect(stats.nodes).toBe(0);
    expect(stats.relations).toBe(0);
    const g = await prisma.graph.findUnique({ where: { graph_id: 'G1' } });
    expect(g?.graph_name).toBe('测试图');
  });

  it('搬运含节点和关系的图谱，关系正确指向 PG 节点', async () => {
    await runQuery(`
      CREATE (g:Graph {graph_id: 'G2', graph_name: 'G2', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (n1:Node {node_id: 'N1', graph_id: 'G2', node_type: 'knowledge_point', name: 'A', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n2:Node {node_id: 'N2', graph_id: 'G2', node_type: 'knowledge_point', name: 'B', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n1)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n2)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n1)-[:PREREQUISITE {relation_type: 'PREREQUISITE', status: 'approved', confidence: 1.0}]->(n2)
    `);
    const stats = await migrateFromNeo4j();
    expect(stats).toMatchObject({ graphs: 1, nodes: 2, relations: 1 });
    const rels = await prisma.relation.findMany({ where: { graph_id: 'G2' } });
    expect(rels[0]).toMatchObject({ source_id: 'N1', target_id: 'N2', relation_type: 'PREREQUISITE' });
  });

  it('幂等 — 二次执行不会重复插入', async () => {
    await runQuery(`CREATE (g:Graph {graph_id: 'G3', graph_name: 'G3', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})`);
    await migrateFromNeo4j();
    await migrateFromNeo4j();
    const count = await prisma.graph.count();
    expect(count).toBe(1);
  });
});
```

**Step 2：跑测试看失败**

```powershell
cd backend
npx vitest run src/scripts/__tests__/migrate-from-neo4j.test.ts
```

预期：FAIL — 模块不存在 / `prisma` 未导出。

**Step 3：实现 prisma client 单例**（如果还没有）

```ts
// backend/src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

**Step 4：实现 migrate-from-neo4j.ts**

```ts
import { runQuery, closeDriver } from '../lib/neo4j.js';
import { prisma } from '../lib/prisma.js';

export interface MigrationStats {
  graphs: number;
  nodes: number;
  relations: number;
}

/**
 * One-shot, idempotent copy of Neo4j → Postgres for the graph data model.
 * Run via `npm -w backend run migrate:from-neo4j` (add script in package.json).
 */
export async function migrateFromNeo4j(): Promise<MigrationStats> {
  // 1. graphs
  const graphs = await runQuery<{ g: Record<string, unknown> }>(
    `MATCH (g:Graph) RETURN g { .* } AS g ORDER BY g.created_at ASC`,
  );
  for (const { g } of graphs) {
    await prisma.graph.upsert({
      where: { graph_id: g.graph_id as string },
      create: mapGraph(g),
      update: mapGraph(g),
    });
  }

  // 2. nodes — must come before relations (FK dependency)
  const nodes = await runQuery<{ n: Record<string, unknown> }>(
    `MATCH (n:Node)-[:BELONGS_TO_GRAPH]->(g:Graph)
     RETURN n { .*, graph_id: g.graph_id } AS n
     ORDER BY n.created_at ASC`,
  );
  for (const { n } of nodes) {
    await prisma.node.upsert({
      where: { node_id: n.node_id as string },
      create: mapNode(n),
      update: mapNode(n),
    });
  }

  // 3. relations (skip BELONGS_TO_GRAPH membership edges)
  const rels = await runQuery<{
    a: { node_id: string };
    b: { node_id: string };
    g: { graph_id: string };
    type: string;
    r: Record<string, unknown>;
  }>(
    `MATCH (a:Node)-[r]->(b:Node)
     MATCH (a)-[:BELONGS_TO_GRAPH]->(g:Graph)
     WHERE type(r) <> 'BELONGS_TO_GRAPH'
     RETURN a { .node_id } AS a, b { .node_id } AS b, g { .graph_id } AS g,
            type(r) AS type, r { .* } AS r`,
  );
  for (const row of rels) {
    await prisma.relation.upsert({
      where: {
        relations_unique_edge: {
          source_id: row.a.node_id,
          target_id: row.b.node_id,
          relation_type: row.type,
        },
      },
      create: {
        source_id: row.a.node_id,
        target_id: row.b.node_id,
        graph_id: row.g.graph_id,
        relation_type: row.type,
        status: (row.r.status as string) ?? 'approved',
        confidence: (row.r.confidence as number) ?? 1.0,
        description: (row.r.description as string) ?? null,
        ai_job_id: (row.r.ai_job_id as string) ?? null,
      },
      update: {
        status: (row.r.status as string) ?? 'approved',
        confidence: (row.r.confidence as number) ?? 1.0,
        description: (row.r.description as string) ?? null,
      },
    });
  }

  return { graphs: graphs.length, nodes: nodes.length, relations: rels.length };
}

function mapGraph(g: Record<string, unknown>) {
  return {
    graph_id: g.graph_id as string,
    graph_name: g.graph_name as string,
    graph_type: g.graph_type as string,
    subject: (g.subject as string) ?? null,
    course_name: (g.course_name as string) ?? null,
    description: (g.description as string) ?? null,
    status: (g.status as string) ?? 'active',
    created_by: (g.created_by as string) ?? null,
  };
}

function mapNode(n: Record<string, unknown>) {
  return {
    node_id: n.node_id as string,
    graph_id: n.graph_id as string,
    node_type: n.node_type as string,
    knowledge_type: (n.knowledge_type as string) ?? null,
    name: n.name as string,
    description: (n.description as string) ?? null,
    status: (n.status as string) ?? 'approved',
    source: (n.source as string) ?? 'manual',
    confidence: (n.confidence as number) ?? 1.0,
    tags: (n.tags as unknown[]) ?? [],
    ai_job_id: (n.ai_job_id as string) ?? null,
  };
}

// CLI entrypoint
if (process.argv[1]?.endsWith('migrate-from-neo4j.ts') ||
    process.argv[1]?.endsWith('migrate-from-neo4j.js')) {
  migrateFromNeo4j()
    .then((stats) => {
      console.log('migrated:', stats);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await closeDriver();
      await prisma.$disconnect();
    });
}
```

**Step 5：跑测试**

```powershell
npx vitest run src/scripts/__tests__/migrate-from-neo4j.test.ts
```

预期：3 个测试全过。

**Step 6：在 backend/package.json 加 npm script**

```json
{
  "scripts": {
    "migrate:from-neo4j": "tsx src/scripts/migrate-from-neo4j.ts"
  }
}
```

**Commit:** `feat(scripts): one-shot Neo4j → Postgres data migration`

---

## 验证

完成所有 task 后跑：

```powershell
cd backend
npx tsc --noEmit                    # 无错
npx vitest run src/scripts          # 3/3 pass
npx prisma migrate status            # up to date
psql $env:DATABASE_URL -c "SELECT extname FROM pg_extension WHERE extname='vector';"  # 返回 1 行
```

---

## 交付物

3 个 commit：
1. `feat(db): add graphs/nodes/relations tables via Prisma`
2. `feat(db): add pgvector extension + embedding column on nodes`
3. `feat(scripts): one-shot Neo4j → Postgres data migration`

**完成后通知 Pack B/C/D 可以并行启动。**
