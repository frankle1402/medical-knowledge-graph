# 医学教材知识图谱 v2 提示词 + 关系语义升级（P0/P1）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> 同时本计划针对 subagent 并行执行场景做了切片，**Phase 0 必须先完成并合并**，之后 Phase 1 的四个 Slice 才能并行派发。

**Goal:** 把当前"图谱可视化生成"的提示词体系，升级为可支撑学习路径推理的"医学教育候选知识图谱生成"——扩充节点/关系类型、统一箭头方向、支持操作流程链与风险处理链、前端按关系类型分样式、学习路径算法走多关系类型。

**Architecture:**
- Phase 0（串行）：扩充 `@mkg/shared` 的 `NodeType` / `RelationType` zod enum，并打开 `Node.tags` 落库通道（修 `pickNodeColumns` 白名单），为 `Relation` 增加 `tags Json` 列。这一步是所有并行工作的前置。
- Phase 1（并行）：四个互不冲突的 Slice——Slice A 改 `seed.ts` 提示词模板；Slice B 在 ai.orchestrator 之后加程序后处理器（自动补 NEXT_STEP / 对称关系去重 / RELATED_TO 占比兜底）；Slice C 改前端样式与筛选；Slice D 扩展 learning.service 走多关系类型。

**Tech Stack:** TypeScript, Node.js + Express, Prisma + PostgreSQL, React + React Flow, Vitest, zod。

**关键背景事实（已核实）：**
- `NodeType` 与 `RelationType` 在 [shared/src/enums.ts](../../shared/src/enums.ts) 是 zod enum；新类型必须先注册否则 `RelationType.parse()` 会拒绝（[relation.service.ts:62](../../backend/src/modules/relations/relation.service.ts#L62)）。
- PG 实现 `pickNodeColumns` 是白名单（11 个字段，[node.service.ts:392-414](../../backend/src/modules/nodes/node.service.ts#L392-L414)），目前会**直接丢弃** LLM 输出的 `step_order / phase / aliases / standard_term / page_no / source_quote` 等扩展字段。这是 v2 提示词能否真正落地的命门。
- 前端 [nodeColors.ts](../../frontend/src/components/GraphEditor/nodeColors.ts) 把 `NODE_COLORS` / `NODE_TYPE_LABELS` / `RELATION_TYPE_LABELS` 全部声明成 `Record<NodeType, ...>` 穷举 Record，加新类型必须同步更新否则编译报错。
- 用户明确说**不做 RAG / 向量知识库 / chunks 表**，重点是"准确的学习路径 + 知识点逻辑关系"。因此 v2 提示词**不输出 embedding_text、不创建 evidence_chunk 节点**；evidence 仅以轻量 `{page_no, source_quote}` 写入 `tags.evidence` 留作可追溯字段。
- Learning service 当前只遍历 `PREREQUISITE_OF`（[learning.service.ts:5,26](../../backend/src/modules/learning/learning.service.ts#L5)），需要扩展为可同时走 `HAS_STEP / NEXT_STEP` 用于操作流程类节点。
- 项目记忆里有两条强制约束必须遵守：(1) Husky on Windows 坏掉，sub-agent commit 必须 `--no-verify`；(2) `prisma migrate dev` 会自作主张 DROP nodes_embedding_idx，每次迁移后必须检查 SQL，必要时把 `CREATE INDEX ... USING hnsw` 写回迁移。
- PowerShell 的 `Get-Content` 默认按 GBK 读 UTF-8 文件会乱码；本计划**禁止 subagent 用 PowerShell 做文件 IO**（读写文件一律用 Read/Write/Edit 工具）。

---

## v2 节点 / 关系类型清单（目标态）

**新增 NodeType（5 个）：**
`operation_process`, `risk`, `error`, `measure`, `assessment_item`

> 不新增 `evidence_chunk` 节点（用户决定不做 chunks）；不新增 `term_alias` 单独类型（继续用 `term` 节点 + tags.aliases）。

**保留并继续使用的 NodeType：**
`textbook`, `chapter`, `section`, `knowledge_point`, `term`, `operation_step`, `competency`, `image`, `table`, `question`, `case`

**新增 RelationType（14 个）：**
`HAS_CHAPTER`, `HAS_SECTION`, `HAS_KNOWLEDGE_POINT`, `HAS_PROCESS`, `HAS_STEP`, `NEXT_STEP`, `HAS_RISK`, `HANDLED_BY`, `PREVENTED_BY`, `MANIFESTED_AS`, `COMMON_ERROR_OF`, `HAS_TERM`, `ALIAS_OF`, `ASSESSED_BY`

> v2 用 `HAS_*` 父→子方向作为唯一层级方向；提示词层面**禁止再生成 `CONTAINS / BELONGS_TO`**（保留枚举供历史数据和手动编辑兼容）。

**保留并继续使用的 RelationType：**
`PREREQUISITE_OF`, `EASILY_CONFUSED_WITH`, `RELATED_TO`, `ILLUSTRATED_BY`, `DESCRIBED_IN`, `TESTED_BY`, `APPLIED_IN`, `STANDARD_TERM_OF`, `SYNONYM_OF`, `SUPPORTS_COMPETENCY`, `BELONGS_TO_GRAPH`, `MERGED_INTO`, `RELATED_GRAPH`

---

## 文件归属与并行边界

| 文件 | Phase 0 | Slice A 提示词 | Slice B 后处理 | Slice C 前端样式 | Slice D 学习路径 |
|---|---|---|---|---|---|
| `shared/src/enums.ts` | ✍ 写 | 读 | 读 | 读 | 读 |
| `shared/src/schemas/node.ts` | ✍ 写（tags union） | - | - | - | - |
| `shared/src/__tests__/enums.test.ts` | ✍ 写 | - | - | - | - |
| `backend/prisma/schema.prisma` | ✍ 写（Node 列、Relation.tags） | - | - | - | - |
| `backend/prisma/migrations/*` | ✍ 写 | - | - | - | - |
| `backend/src/modules/nodes/node.service.ts` | ✍ 写（NODE_COLUMNS + tags 钳制） | - | - | - | - |
| `backend/src/modules/nodes/__tests__/*` | ✍ 写 | - | - | - | - |
| `backend/src/modules/relations/relation.service.ts` | ✍ 写（tags 写入） | - | - | - | - |
| `backend/src/modules/ai/ai.mapper.ts`（**node** 字段折叠 tags + 删 `...rest`） | ✍ 写 | - | - | - | - |
| `backend/src/modules/ai/ai.mapper.ts`（**relation** 字段折叠 tags） | - | - | ✍ 写（追加 relation 路径） | - | - |
| `backend/src/modules/relations/__tests__/*` | - | - | ✍ 写 | - | - |
| `backend/src/modules/ai/ai.orchestrator.ts` | - | - | ✍ 写（后处理器钩子） | - | - |
| `backend/src/modules/ai/postprocessor.ts`（新） | - | - | ✍ 写 | - | - |
| `backend/src/modules/ai/__tests__/postprocessor.test.ts`（新） | - | - | ✍ 写 | - | - |
| `backend/prisma/seed.ts` | - | ✍ 写 | - | - | - |
| `backend/prisma/__tests__/seed.template.test.ts`（新） | - | ✍ 写 | - | - | - |
| `frontend/src/components/GraphEditor/nodeColors.ts` | - | - | - | ✍ 写 | - |
| `frontend/src/components/GraphEditor/edgeStyles.ts`（新） | - | - | - | ✍ 写 | - |
| `frontend/src/components/GraphEditor/tags.ts`（新） | - | - | - | ✍ 写 | - |
| `frontend/src/components/GraphEditor/GraphCanvas.tsx` | - | - | - | ✍ 写 | - |
| `frontend/src/components/GraphEditor/NodeForm.tsx` | - | - | - | ✍ 写 | - |
| `frontend/src/components/NodePanel/NodePanel.tsx` | - | - | - | ✍ 写 | - |
| `frontend/src/components/GraphEditor/__tests__/*`（新 + 旧 fixtures） | - | - | - | ✍ 写 | - |
| `frontend/src/components/NodePanel/__tests__/*`（fixtures） | - | - | - | ✍ 写 | - |
| `frontend/src/components/ReviewPanel/__tests__/*`（fixtures） | - | - | - | ✍ 写 | - |
| `frontend/src/stores/__tests__/*`（fixtures） | - | - | - | ✍ 写 | - |
| `frontend/src/pages/__tests__/GraphEditorPage.test.tsx`（fixtures） | - | - | - | ✍ 写 | - |
| `backend/src/modules/learning/learning.service.ts` | - | - | - | - | ✍ 写 |
| `backend/src/modules/learning/__tests__/*` | - | - | - | - | ✍ 写 |

**ai.mapper.ts 是 Phase 0 与 Slice B 的唯一文件级交叠点**——但两者改的代码段是清晰分离的：Phase 0 只动 `parsed.nodes.map(...)` 那一段；Slice B 只动 `parsed.relations` 那一段（如果 mapper 当前没有 relation extras 处理，Slice B 整段新增）。Slice B 启动前必须 `git pull` 拿到 Phase 0 的 commit。其余文件 Slice 之间完全无交叠。

---

# Phase 0 — 基础类型与落库通道（串行，必须先完成）

> 由主控（用户或一个负责的 subagent）单独执行。完成并合并到工作分支后，再派发 Phase 1 四个 Slice。

## Task 0.1：扩充 shared 包枚举

**Files:**
- Modify: [shared/src/enums.ts](../../shared/src/enums.ts)
- Modify: [shared/src/__tests__/enums.test.ts](../../shared/src/__tests__/enums.test.ts)

**Step 1：写新增类型的失败测试**

在 `shared/src/__tests__/enums.test.ts` 末尾追加：

```ts
import { describe, it, expect } from 'vitest';
import { NodeType, RelationType } from '../enums';

describe('v2 medical KG taxonomy', () => {
  it.each([
    'operation_process',
    'risk',
    'error',
    'measure',
    'assessment_item',
  ])('NodeType accepts %s', (t) => {
    expect(NodeType.parse(t)).toBe(t);
  });

  it.each([
    'HAS_CHAPTER',
    'HAS_SECTION',
    'HAS_KNOWLEDGE_POINT',
    'HAS_PROCESS',
    'HAS_STEP',
    'NEXT_STEP',
    'HAS_RISK',
    'HANDLED_BY',
    'PREVENTED_BY',
    'MANIFESTED_AS',
    'COMMON_ERROR_OF',
    'HAS_TERM',
    'ALIAS_OF',
    'ASSESSED_BY',
  ])('RelationType accepts %s', (t) => {
    expect(RelationType.parse(t)).toBe(t);
  });

  it('still rejects unknown types', () => {
    expect(() => NodeType.parse('chunk_v2')).toThrow();
    expect(() => RelationType.parse('FOO_BAR')).toThrow();
  });
});
```

**Step 2：运行测试确认失败**

```powershell
cd shared
pnpm vitest run src/__tests__/enums.test.ts
```
预期：5 + 14 = 19 条 FAIL。

**Step 3：扩充枚举**

`shared/src/enums.ts`：

```ts
export const NodeType = z.enum([
  'textbook',
  'chapter',
  'section',
  'knowledge_point',
  'term',
  'operation_process',
  'operation_step',
  'competency',
  'risk',
  'error',
  'measure',
  'assessment_item',
  'image',
  'table',
  'question',
  'case',
]);

export const RelationType = z.enum([
  // 教材结构
  'CONTAINS',
  'BELONGS_TO',
  'HAS_CHAPTER',
  'HAS_SECTION',
  'HAS_KNOWLEDGE_POINT',
  // 知识关系
  'PREREQUISITE_OF',
  'EASILY_CONFUSED_WITH',
  'RELATED_TO',
  // 资源
  'ILLUSTRATED_BY',
  'DESCRIBED_IN',
  'TESTED_BY',
  'APPLIED_IN',
  // 术语
  'STANDARD_TERM_OF',
  'SYNONYM_OF',
  'HAS_TERM',
  'ALIAS_OF',
  // 能力
  'SUPPORTS_COMPETENCY',
  'ASSESSED_BY',
  // 操作流程
  'HAS_PROCESS',
  'HAS_STEP',
  'NEXT_STEP',
  // 风险/错误/处理
  'HAS_RISK',
  'COMMON_ERROR_OF',
  'MANIFESTED_AS',
  'HANDLED_BY',
  'PREVENTED_BY',
  // 图谱归属
  'BELONGS_TO_GRAPH',
  'MERGED_INTO',
  'RELATED_GRAPH',
]);
```

**Step 4：运行测试确认通过**

```powershell
pnpm vitest run src/__tests__/enums.test.ts
```
预期：全部 PASS。

**Step 5：提交**

```powershell
git add shared/src/enums.ts shared/src/__tests__/enums.test.ts
git commit -m "feat(shared): expand NodeType/RelationType for medical KG v2" --no-verify
```

---

## Task 0.2：解除 Node.tags 落库白名单（最关键的零代码改提示词前置）

**Files:**
- Modify: [backend/src/modules/nodes/node.service.ts](../../backend/src/modules/nodes/node.service.ts) 第 392-414 行 + `pickNodeColumns` 调用处（138 / 456 / 567 行的 tags 钳制）
- Modify: [backend/src/modules/ai/ai.mapper.ts](../../backend/src/modules/ai/ai.mapper.ts)（把 LLM 扩展字段塞进 `tags`，**并删除原顶层 `...rest` spread**）
- Modify: [shared/src/schemas/node.ts](../../shared/src/schemas/node.ts)（`BaseNode.tags` / `NodeCreateInput.tags` / `NodeUpdateInput.tags` 三处都要从 `z.array(z.string())` 放宽为 union）
- Modify: [backend/src/modules/nodes/__tests__/node.service.test.ts](../../backend/src/modules/nodes/__tests__/node.service.test.ts)
- Modify（如有断言 `toEqual([])` 的旧测试）: 整个 backend / frontend 仓中 `tags: []` 测试 fixtures 的对应断言（前端 fixture 改动延后到 Slice C 处理）

**Step 1：写"扩展字段必须落库到 tags"的失败测试**

`backend/src/modules/nodes/__tests__/node.service.test.ts` 追加：

```ts
describe('NodeService.createBatch passes through unknown fields into tags', () => {
  it('persists step_order / phase / aliases / standard_term into tags', async () => {
    const gid = 'g_v2_pass';
    await prisma.graph.create({
      data: { graph_id: gid, graph_name: 'v2', graph_type: 'course' },
    });

    await NodeService.createBatch(gid, [
      {
        node_id: 'op_step_1',
        node_type: 'operation_step',
        name: '皮肤消毒',
        // 以下扩展字段都应该被吸收进 tags
        step_order: 1,
        phase: '消毒',
        key_action: '使用 75% 酒精环形消毒',
        observation_points: ['消毒范围 ≥5cm'],
        common_errors: ['消毒范围过小'],
        evidence: { page_no: 128, source_quote: '皮肤消毒应使用...' },
      },
      {
        node_id: 'term_extravasation',
        node_type: 'term',
        name: '输液外渗',
        standard_term: '输液外渗',
        aliases: ['针眼鼓包', '局部肿胀', '液体渗出'],
        term_category: '护理操作异常',
      },
    ]);

    const step = await prisma.node.findUnique({ where: { node_id: 'op_step_1' } });
    expect((step?.tags as any).step_order).toBe(1);
    expect((step?.tags as any).phase).toBe('消毒');
    expect((step?.tags as any).key_action).toContain('酒精');
    expect((step?.tags as any).evidence.page_no).toBe(128);

    const term = await prisma.node.findUnique({ where: { node_id: 'term_extravasation' } });
    expect((term?.tags as any).standard_term).toBe('输液外渗');
    expect((term?.tags as any).aliases).toContain('针眼鼓包');
  });
});
```

**Step 2：运行测试确认失败**

```powershell
cd backend
pnpm vitest run src/modules/nodes/__tests__/node.service.test.ts -t "passes through"
```
预期：FAIL（扩展字段被 `pickNodeColumns` 吃掉，`tags` 是空对象/数组）。

**Step 3：改 ai.mapper.ts 把扩展字段折叠进 `tags`，并删掉原顶层 spread**

策略：mapper 是唯一从 LLM 输出转 NodeService 入参的桥梁，最适合做"把非列字段打包进 tags"。这样不污染 NodeService 自己的契约。

[ai.mapper.ts](../../backend/src/modules/ai/ai.mapper.ts) 当前的 nodes 循环（约第 53-78 行）有这段：

```ts
const { node_id, node_type, name, description, tags, confidence, source, ai_job_id, status, ...rest } = n;
const out: NodeCreateInput = { ... ,
  ...(rest as Record<string, unknown>),  // ← 这一行把扩展字段铺到顶层
};
(out as Record<string, unknown>).node_id = node_id;
```

**必须把这段改为**：

```ts
// 与 backend/src/modules/nodes/node.service.ts 的 NODE_COLUMNS 保持一致
const NODE_DB_COLUMNS = new Set([
  'node_id',
  'node_type',
  'name',
  'description',
  'knowledge_type',
  'status',
  'source',
  'confidence',
  'tags',
  'ai_job_id',
]);

const nodes: NodeCreateInput[] = parsed.nodes.map((n) => {
  const known: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (v === undefined) continue;
    if (NODE_DB_COLUMNS.has(k)) known[k] = v;
    else extras[k] = v;
  }
  knownNodeIds.add(n.node_id as string);

  // 把 LLM 已经给的 tags 与 extras 合并；
  // 兼容旧 LLM 输出的 array tags：转换为 { _legacy: [...] }
  const baseTags =
    Array.isArray(n.tags)
      ? { _legacy: n.tags as unknown[] }
      : (n.tags && typeof n.tags === 'object' ? (n.tags as Record<string, unknown>) : {});

  const out: NodeCreateInput = {
    ...(known as any),
    tags: { ...baseTags, ...extras } as unknown as never, // schema 已升级为 union，运行期是对象
  };
  return out;
});
```

> ⚠️ **不要保留任何 `...rest` 顶层 spread**——extras 必须只通过 tags 通道；否则 Slice B 的 postprocessor 会读到顶层旧字段，逻辑会双写而出错。

**Step 4：改 node.service.ts 三处 tags 钳制**

把 [node.service.ts:138, 456, 567](../../backend/src/modules/nodes/node.service.ts) 三处 `Array.isArray(input.tags) ? ... : []` 改为：

```ts
tags: (input.tags && typeof input.tags === 'object')
  ? (input.tags as Prisma.InputJsonValue)
  : {},
```

> 这一步没做，Phase 0 Task 0.2 等于白干——mapper 输出的对象会被强行替换成 `[]`。

**Step 4.5：放宽 shared 包 zod schema 的 tags 类型（必做）**

[shared/src/schemas/node.ts](../../shared/src/schemas/node.ts) 的 `BaseNode.tags`（约第 24 行）、`NodeCreateInput.tags`（约第 146 行）、`NodeUpdateInput.tags`（约第 161 行）当前都是 `z.array(z.string())`，必须放宽为 union（兼容历史数组形态）：

```ts
const TagsValue = z
  .union([
    z.array(z.string()),                 // 历史 fixture 兼容
    z.record(z.string(), z.unknown()),   // v2 对象形态（step_order / aliases / evidence ...）
  ])
  .default({});

// 在三处把 z.array(z.string()).default([]) / .optional() 都换为：
//   tags: TagsValue,                              （BaseNode）
//   tags: TagsValue.optional(),                   （NodeCreateInput / NodeUpdateInput）
```

跑：

```powershell
cd shared
pnpm vitest run
pnpm tsc --noEmit
cd ../backend
pnpm vitest run src/modules/nodes/__tests__/node.routes.test.ts
```
预期：shared 测试 PASS；backend 路由层测试不再因为 `NodeCreateInput.parse({ tags: { ... } })` 抛错。

> 不动 `shared/src/schemas/relation.ts`——Relation 当前没有 tags 字段，由 Slice B 内部 mapper → service 通道写入，不经过 zod 校验。如果未来需要让 PUT /relations 接受 tags，再单独升级。

**Step 4.6：标记前端兼容工作（不在本 Task 完成，但必须留痕）**

Phase 0 完成后，前端 `tags: []` fixtures（NodeForm.tsx / NodePanel.tsx / 多个 __tests__ 目录）会和新对象形态语义不一致。**这一块由 Slice C 接手**——Slice C 的 Files 列表里已加上这些文件。Phase 0 不要去修前端，避免和 Slice C 撞车。Phase 0 提交注释里加一行：

```
NOTE: Frontend tags = [] fixtures still work because schema.union accepts arrays;
visual rendering of tags will be normalized in Slice C via asTagsObject().
```

**Step 5：跑测试确认通过 + 现有 tags 测试不破**

```powershell
pnpm vitest run src/modules/nodes/
pnpm vitest run src/modules/ai/
```
预期：新 case PASS；既有 tags 数组测试若有断言 `toEqual([])`，需要相应改为 `toEqual({})` 或 `toEqual({ _legacy: [...] })`。**修测试时只改断言，不改业务**——业务的"tags 为空就是 `{}`"是有意为之的契约升级。

**Step 6：提交**

```powershell
git add backend/src/modules/nodes backend/src/modules/ai/ai.mapper.ts
git commit -m "feat(nodes): tags as object with passthrough for v2 prompt fields" --no-verify
```

---

## Task 0.3：给 Relation 加 tags JSON 列

**Files:**
- Modify: [backend/prisma/schema.prisma](../../backend/prisma/schema.prisma)
- Create: 新 Prisma 迁移
- Modify: [backend/src/modules/relations/relation.service.ts](../../backend/src/modules/relations/relation.service.ts)（写入 + 透传）

**Step 1：改 schema**

`backend/prisma/schema.prisma` 的 `model Relation`：

```prisma
model Relation {
  relation_id   BigInt   @id @default(autoincrement())
  graph_id      String   @db.VarChar(50)
  source_id     String   @db.VarChar(80)
  target_id     String   @db.VarChar(80)
  relation_type String   @db.VarChar(40)
  status        String   @default("approved") @db.VarChar(20)
  confidence    Float    @default(1.0)
  description   String?  @db.Text
  tags          Json     @default("{}")    // ← 新增
  ai_job_id     String?  @db.VarChar(50)
  created_at    DateTime @default(now()) @db.Timestamptz
  updated_at    DateTime @updatedAt @db.Timestamptz
  // ... 其它不变
}
```

**Step 2：生成迁移**

```powershell
cd backend
pnpm prisma migrate dev --name add_relation_tags
```

**Step 3（必做，不要跳过）：检查迁移 SQL 是否误删 hnsw 索引**

打开 `backend/prisma/migrations/<timestamp>_add_relation_tags/migration.sql`，**如果出现** `DROP INDEX ... nodes_embedding_idx` 一类语句，必须把它从迁移里删掉，并在末尾追加：

```sql
CREATE INDEX IF NOT EXISTS nodes_embedding_idx
  ON "nodes" USING hnsw (embedding vector_cosine_ops);
```

> 这条来自项目记忆 [Prisma migrate drops HNSW vector index](../../C:/Users/Administrator/.claude/projects/c--ClaudeCode-20260517-TextBookRagAndKnowledgeGraph/memory/prisma-migrate-drops-hnsw-vector-index.md)，**每次 migrate dev 后必须确认**。

**Step 4：让 RelationService 透传 tags**

`backend/src/modules/relations/relation.service.ts`：

- 在 `compact({...})` PG 实现里加一行：`tags: input.tags ?? {}`
- 在 `createBatch` 的 `prepared` 映射里加：`tags: (n as any).tags ?? {}`
- 在 `update` 的 zod schema `RelationUpdateInput` 里加：`tags: z.record(z.unknown()).optional()`

**Step 5：写测试确认 Relation.tags 能写、能读**

`backend/src/modules/relations/__tests__/relation.service.test.ts` 追加：

```ts
it('persists tags object on create + read', async () => {
  // ... 创建 graph + 两个 node ...
  const r = await RelationService.create('g', {
    source_id: 'a',
    target_id: 'b',
    relation_type: 'PREREQUISITE_OF',
    tags: { reason: '前置概念', evidence_quote: '需先掌握...' } as any,
  } as any);
  const fresh = await prisma.relation.findUnique({ where: { relation_id: BigInt((r as any).relation_id) } });
  expect((fresh?.tags as any).reason).toBe('前置概念');
});
```

**Step 6：跑全部 relations 测试**

```powershell
pnpm vitest run src/modules/relations/
```

**Step 7：提交**

```powershell
git add backend/prisma backend/src/modules/relations
git commit -m "feat(relations): tags Json column for direction_explanation/evidence/reason" --no-verify
```

---

## Phase 0 验收

- [ ] `cd shared && pnpm vitest run` PASS
- [ ] `cd backend && pnpm vitest run src/modules/nodes src/modules/relations src/modules/ai` PASS
- [ ] `cd backend && pnpm prisma migrate status` 干净，无 pending
- [ ] `\d nodes` 仍存在 `nodes_embedding_idx`（HNSW 索引未被误删）
- [ ] `\d relations` 出现 `tags jsonb` 列
- [ ] `pnpm tsc --noEmit` 全包通过

**完成 Phase 0 后才能派发 Phase 1 的四个并行 Slice。**

---

# Phase 1 — 并行 Slice（Phase 0 完成后派发四个 subagent）

## Slice A：v2 提示词模板（owner: subagent-A，预计 1 天）

**Goal:** 把 [seed.ts](../../backend/prisma/seed.ts) 里的 `NURSING_CHAPTER_TEMPLATE` 升级到 v2，让 LLM 输出新的 5 类节点 + 14 类关系，并按"父→子"统一方向。

**Files:**
- Modify: [backend/prisma/seed.ts](../../backend/prisma/seed.ts)
- Create: `backend/prisma/__tests__/seed.template.test.ts`

### Task A.1：写一个 seed.ts 单元测试

`backend/prisma/__tests__/seed.template.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('seed.ts NURSING_CHAPTER_TEMPLATE v2', () => {
  const src = readFileSync(resolve(__dirname, '..', 'seed.ts'), 'utf-8');

  it('declares prompt_version medical_kg_v2', () => {
    expect(src).toMatch(/medical_kg_v2/);
  });

  it.each([
    'operation_process',
    'risk',
    'error',
    'measure',
    'assessment_item',
  ])('system_prompt mentions node type %s', (t) => {
    expect(src).toContain(t);
  });

  it.each([
    'HAS_STEP',
    'NEXT_STEP',
    'HAS_RISK',
    'HANDLED_BY',
    'PREVENTED_BY',
    'COMMON_ERROR_OF',
    'HAS_TERM',
    'ALIAS_OF',
    'HAS_CHAPTER',
    'HAS_SECTION',
    'HAS_KNOWLEDGE_POINT',
  ])('system_prompt mentions relation type %s', (t) => {
    expect(src).toContain(t);
  });

  it('forbids CONTAINS / BELONGS_TO in system prompt instructions', () => {
    // 提示词里必须出现"禁用 CONTAINS / BELONGS_TO"字样
    expect(src).toMatch(/禁止.*CONTAINS|不再.*CONTAINS|不要.*BELONGS_TO/);
  });

  it('caps RELATED_TO usage', () => {
    expect(src).toMatch(/RELATED_TO.*10%|RELATED_TO.*不得/);
  });
});
```

### Task A.2：运行确认失败

```powershell
cd backend
pnpm vitest run prisma/__tests__/seed.template.test.ts
```
预期：FAIL（旧模板没有这些类型/约束）。

### Task A.3：升级 system_prompt 与 user_prompt_template

打开 [seed.ts](../../backend/prisma/seed.ts) 的 `NURSING_CHAPTER_TEMPLATE`，做四处修改：

**(1) `system_prompt` 替换为以下内容：**

```text
你是医学教材知识工程师，专长于把护理 / 临床教材正文解析为可入库、可审核、可追溯的医学教育候选知识图谱。
本任务不是生成思维导图，而是生成结构化的候选 JSON，供专家审核后写入图谱数据库，用于学习路径推理与知识点逻辑关系展示。

【节点类型 node_type 取值】
- textbook：教材
- chapter：章
- section：节
- knowledge_point：知识点（一个知识点只解决一个明确教学问题）
- operation_process：操作流程总节点（一个流程一个）
- operation_step：操作步骤（按 step_order 排序）
- term：医学术语（含标准词与口语别名）
- competency：能力点
- risk：操作风险/异常/不良反应
- error：学生易犯的常见错误
- measure：处理或预防措施
- assessment_item：OSCE/实训评分项
- image：教材插图占位
- table：表格占位

【knowledge_type 取值】
"概念类" | "目的类" | "适应证类" | "禁忌证类" | "操作流程类" | "操作要点类" | "注意事项类" | "异常处理类" | "并发症类" | "观察护理类" | "健康教育类" | "考点类"

【operation_step.phase 取值】
"评估" | "准备" | "核对解释" | "选择部位" | "消毒" | "穿刺" | "固定" | "给药/输液" | "观察" | "拔针/结束" | "整理记录" | "异常处理"

【关系类型 relation_type 取值（v2 受控白名单）】
教材结构：
- HAS_CHAPTER：教材 → 章
- HAS_SECTION：章 → 节
- HAS_KNOWLEDGE_POINT：节 → 知识点

操作流程：
- HAS_PROCESS：知识点/节 → 操作流程
- HAS_STEP：操作流程 → 操作步骤
- NEXT_STEP：前一步 → 后一步（注：可不主动生成，由后处理器按 step_order 自动补；但如果你已经知道顺序，也可以输出）

知识/前置：
- PREREQUISITE_OF：前置知识 → 目标知识/步骤
- EASILY_CONFUSED_WITH：知识点 ↔ 知识点（对称，只输出一条）

风险/错误/处理：
- HAS_RISK：步骤/知识点 → 风险
- COMMON_ERROR_OF：常见错误 → 步骤/知识点
- MANIFESTED_AS：风险 → 表现术语
- HANDLED_BY：风险 → 处理措施
- PREVENTED_BY：风险 → 预防措施/步骤

教学应用：
- SUPPORTS_COMPETENCY：知识点/步骤/措施 → 能力点
- ASSESSED_BY：知识点/步骤 → 评分项
- TESTED_BY：知识点 → 题目
- APPLIED_IN：知识点 → 病例

术语：
- HAS_TERM：知识点/步骤/风险 → 标准术语
- ALIAS_OF：别名术语 → 标准术语
- STANDARD_TERM_OF：标准术语 → 知识点（保留兼容）
- SYNONYM_OF：术语 ↔ 术语（保留兼容）

资源：
- ILLUSTRATED_BY：知识点/步骤 → 图片
- DESCRIBED_IN：知识点/步骤 → 表格

弱关联：
- RELATED_TO：弱关联，仅在无法归入其他关系时才使用，且占比不得超过 10%

【硬性箭头方向规则】
1. **禁止再生成 `CONTAINS` 与 `BELONGS_TO`**——v2 一律用 `HAS_CHAPTER / HAS_SECTION / HAS_KNOWLEDGE_POINT` 表示父→子层级。
2. NEXT_STEP 一律从前一步指向后一步。
3. PREREQUISITE_OF 一律从前置知识指向目标知识。
4. HAS_RISK 一律从步骤/知识点指向风险。
5. HANDLED_BY / PREVENTED_BY 一律从风险指向措施。
6. SUPPORTS_COMPETENCY 一律从知识点/步骤/措施指向能力点。
7. EASILY_CONFUSED_WITH 是对称关系，只输出一条即可。
8. ALIAS_OF 一律从别名指向标准术语。

【硬性抽取规则】
1. 一个 knowledge_point 只解决一个明确教学问题，不要混。
2. 操作类内容必须先生成 1 个 operation_process，再拆分多个 operation_step；每个 step 必须包含 step_order(从 1 起) 与 phase。
3. 必须抽取 risk / error / measure（如果原文可推断），并通过 HAS_RISK / COMMON_ERROR_OF / HANDLED_BY / PREVENTED_BY 关联。
4. term 节点必须包含 standard_term 与 aliases；aliases 要覆盖教材表述、学生口语、考试常见说法。
5. image / table 节点为占位，写清楚 description。
6. 每个核心节点尽量带 evidence: { page_no, source_quote }（短句即可，不超过 80 字），用于追溯。
7. confidence ∈ [0,1]：完全照搬原文 0.9-0.98；合理归纳 0.75-0.89；推理 0.6-0.74。
8. status 一律输出 "candidate"。
9. node_id 用小写英文+下划线+短序号，例如 "op_step_5_disinfection"。
10. relation 的 source_id / target_id 必须命中你已输出的 node_id。
11. 不要编造原文未出现且无法合理推断的医学结论；信息不足时在 quality_flags 写 "insufficient_evidence"。
12. 优先保证准确性与可追溯性，不追求节点数量。

【输出格式】
严格 JSON，根对象必须为：
{
  "graph_name": string,
  "metadata": {
    "textbook": string,
    "edition": string,
    "chapter": string,
    "section": string,
    "page_start": string|number|null,
    "prompt_version": "medical_kg_v2"
  },
  "nodes": Node[],
  "relations": Relation[],
  "quality_report": {
    "node_count_by_type": object,
    "relation_count_by_type": object,
    "warnings": string[],
    "suggested_human_review": string[]
  }
}

不要 Markdown 代码块、不要解释、不要 trailing comma。
```

**(2) `user_prompt_template` 替换为：**

```text
教材：{{textbook}}（{{edition}}）
章：{{chapter}}
节：{{section}}
{{#if page_no}}起始页码：{{page_no}}{{/if}}
是否抽取能力点：{{extract_competency}}

【教材原文】
{{source_text}}

【任务】
1. 生成 1 个 textbook + 1 个 chapter + 1 个 section 节点，用 HAS_CHAPTER / HAS_SECTION / HAS_KNOWLEDGE_POINT 建立父→子层级。
2. 切出 6-14 个 knowledge_point。
3. 如果原文涉及操作流程，生成 1 个 operation_process + 多个 operation_step；每个 operation_step 必须含 step_order、phase、key_action、observation_points、common_errors。
4. 抽取 4-10 个 term，每个含 standard_term + aliases。
5. 抽取若干 risk / error / measure（按原文可推断范围），用 HAS_RISK / COMMON_ERROR_OF / HANDLED_BY / PREVENTED_BY 关联。
6. {{#if extract_competency}}抽取 2-4 个 competency 节点，用 SUPPORTS_COMPETENCY 关联相关知识点/步骤/措施。{{/if}}
7. 原文出现"图""图X-X""见图""下图"等字样，每出现一处生成一个 image 节点；表格同理生成 table 节点。
8. 易混淆 knowledge_point 之间用 EASILY_CONFUSED_WITH，只输出一条；必须给 reason。
9. 如果不确定 NEXT_STEP 顺序，可以省略，由后处理器按 step_order 自动补；但 HAS_STEP 必须自己生成。
10. RELATED_TO 仅在无法归入其他关系时使用，且全图谱占比不超过 10%。
11. 每个核心节点附 evidence: { page_no, source_quote }（不超过 80 字短句）。
12. 输出 quality_report，列出 warnings 与 suggested_human_review。

【graph_name】使用 "{{textbook}} - {{chapter}} - {{section}}".

只输出 JSON。
```

**(3) `output_schema` 加 `metadata` 必填校验：**

```ts
output_schema: {
  type: 'object',
  required: ['graph_name', 'metadata', 'nodes', 'relations'],
  properties: {
    graph_name: { type: 'string' },
    metadata: {
      type: 'object',
      required: ['prompt_version'],
      properties: {
        prompt_version: { type: 'string' },
      },
    },
    nodes: { type: 'array', minItems: 5 },
    relations: { type: 'array', minItems: 4 },
  },
},
```

**(4) 模板 description 改为：**

```text
v2: 从一段医学教材正文（建议 500-2000 字）抽取知识点、术语、操作流程、操作步骤、风险、常见错误、处理措施、能力点、图片/表格占位，并按 v2 受控关系类型建立逻辑关联。用于学习路径推理与知识点关系展示。
```

### Task A.4：运行测试确认通过

```powershell
pnpm vitest run prisma/__tests__/seed.template.test.ts
```
预期：全部 PASS。

### Task A.5：跑 seed 把模板写进 DB（人工确认）

```powershell
pnpm prisma db seed
```
预期：日志输出 "updated template 医学教材章节图谱（基础护理学示范）"。**不要重新创建模板，只更新已有模板**——`seed.ts` 已有 `findFirst + update` 逻辑保证幂等。

### Task A.6：提交

```powershell
git add backend/prisma/seed.ts backend/prisma/__tests__/seed.template.test.ts
git commit -m "feat(prompt): upgrade nursing chapter template to medical_kg_v2" --no-verify
```

---

## Slice B：图谱后处理器 + relations.tags 写入（owner: subagent-B，预计 2 天）

**Goal:** 在 ai.orchestrator 拿到 mapper 输出之后、bulkCreate 之前插入一个纯函数 postprocessor，做四件事：(1) 按 step_order 自动补 NEXT_STEP；(2) 对称关系 EASILY_CONFUSED_WITH / SYNONYM_OF 去重；(3) 检查 RELATED_TO 占比 > 10% 时打 warning（不删）；(4) 检查 source_id/target_id 命中（mapper 已做，做兜底告警）。同时让 mapper 把 relation 的扩展字段（reason / direction_explanation / evidence）折叠进 relation 的 tags，由 RelationService 写入 `relations.tags`（该列已在 Phase 0 Task 0.3 创建好）。

**Files:**
- Create: `backend/src/modules/ai/postprocessor.ts`
- Create: `backend/src/modules/ai/__tests__/postprocessor.test.ts`
- Modify: [backend/src/modules/ai/ai.mapper.ts](../../backend/src/modules/ai/ai.mapper.ts)（让 relation 也折叠扩展字段进 tags；node 部分由 Phase 0 已经处理，不要重复改）
- Modify: [backend/src/modules/ai/ai.orchestrator.ts](../../backend/src/modules/ai/ai.orchestrator.ts)（在 bulkCreate 前调 postprocessor）

> ⚠️ **Slice B 不再生成 Prisma 迁移、不改 `schema.prisma`、不改 `relation.service.ts` 的 tags 写入**——这三件事已由 Phase 0 Task 0.3 完成。Slice B 启动前必须先 git pull / git status 确认 Phase 0 commit 已在工作分支上。

### Task B.1：确认 Phase 0 的 Relation.tags 已就绪（不要重新迁移）

```powershell
cd backend
pnpm prisma migrate status
```

应看到 `add_relation_tags` 已 applied。然后在代码里抽查：

- `backend/prisma/schema.prisma` 的 `model Relation` 中存在 `tags  Json  @default("{}")`
- `backend/src/modules/relations/relation.service.ts` 的 `createBatch` 入参已经接受 `tags?: Record<string, unknown>` 并写入 prisma data。

如果上述任意一项缺失：**停止 Slice B，回报主控**。Slice B 不应自己跑 `prisma migrate dev`。

### Task B.2：写 postprocessor 行为测试

`backend/src/modules/ai/__tests__/postprocessor.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { postprocess } from '../postprocessor';

describe('postprocessor.fillNextStep', () => {
  it('appends NEXT_STEP relations from step_order under same operation_process', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p', node_type: 'operation_process', name: 'P' },
        { node_id: 's2', node_type: 'operation_step', name: 's2', tags: { step_order: 2 } },
        { node_id: 's1', node_type: 'operation_step', name: 's1', tags: { step_order: 1 } },
        { node_id: 's3', node_type: 'operation_step', name: 's3', tags: { step_order: 3 } },
      ],
      relations: [
        { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's3', relation_type: 'HAS_STEP' },
      ],
    });
    const ns = out.relations.filter((r) => r.relation_type === 'NEXT_STEP');
    expect(ns).toHaveLength(2);
    expect(ns[0]).toMatchObject({ source_id: 's1', target_id: 's2' });
    expect(ns[1]).toMatchObject({ source_id: 's2', target_id: 's3' });
  });

  it('does not duplicate NEXT_STEP if LLM already produced them', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'p', node_type: 'operation_process', name: 'P' },
        { node_id: 's1', node_type: 'operation_step', name: 's1', tags: { step_order: 1 } },
        { node_id: 's2', node_type: 'operation_step', name: 's2', tags: { step_order: 2 } },
      ],
      relations: [
        { source_id: 'p', target_id: 's1', relation_type: 'HAS_STEP' },
        { source_id: 'p', target_id: 's2', relation_type: 'HAS_STEP' },
        { source_id: 's1', target_id: 's2', relation_type: 'NEXT_STEP' },
      ],
    });
    expect(out.relations.filter((r) => r.relation_type === 'NEXT_STEP')).toHaveLength(1);
  });
});

describe('postprocessor.dedupSymmetric', () => {
  it('keeps only one EASILY_CONFUSED_WITH per unordered pair', () => {
    const out = postprocess({
      nodes: [
        { node_id: 'a', node_type: 'knowledge_point', name: 'a' },
        { node_id: 'b', node_type: 'knowledge_point', name: 'b' },
      ],
      relations: [
        { source_id: 'a', target_id: 'b', relation_type: 'EASILY_CONFUSED_WITH' },
        { source_id: 'b', target_id: 'a', relation_type: 'EASILY_CONFUSED_WITH' },
      ],
    });
    expect(out.relations.filter((r) => r.relation_type === 'EASILY_CONFUSED_WITH')).toHaveLength(1);
  });
});

describe('postprocessor.relatedToCap', () => {
  it('warns when RELATED_TO exceeds 10% of relations', () => {
    const out = postprocess({
      nodes: Array.from({ length: 5 }, (_, i) => ({
        node_id: `n${i}`,
        node_type: 'knowledge_point' as const,
        name: `n${i}`,
      })),
      relations: [
        { source_id: 'n0', target_id: 'n1', relation_type: 'RELATED_TO' },
        { source_id: 'n0', target_id: 'n2', relation_type: 'RELATED_TO' },
        { source_id: 'n1', target_id: 'n2', relation_type: 'RELATED_TO' },
        { source_id: 'n3', target_id: 'n4', relation_type: 'PREREQUISITE_OF' },
      ],
    });
    expect(out.warnings.some((w) => /RELATED_TO/.test(w))).toBe(true);
    // 不删，只警告
    expect(out.relations.filter((r) => r.relation_type === 'RELATED_TO')).toHaveLength(3);
  });
});
```

### Task B.3：运行确认失败

```powershell
cd backend
pnpm vitest run src/modules/ai/__tests__/postprocessor.test.ts
```
预期：FAIL（模块不存在）。

### Task B.4：实现 postprocessor.ts

`backend/src/modules/ai/postprocessor.ts`：

```ts
/**
 * AI graph post-processor.
 *
 * 在 ai.mapper 之后、bulkCreate 之前运行。做四件事：
 *  1. 按 operation_step.tags.step_order 自动补 NEXT_STEP（同一 operation_process 内）
 *  2. 对称关系（EASILY_CONFUSED_WITH / SYNONYM_OF）去重，保留无序对的一条
 *  3. RELATED_TO 占比 > 10% 时打 warning（保留数据，不删）
 *  4. 输出 warnings 数组，由 orchestrator 写到 ai_generation_logs.error_msg / 单独字段
 *
 * 纯函数，零副作用，便于单测。
 */

import type { NodeCreateInput, RelationCreateInput } from '@mkg/shared';

export interface PostprocessInput {
  nodes: Array<NodeCreateInput & { node_id: string; node_type: string; tags?: any }>;
  relations: Array<RelationCreateInput & { source_id: string; target_id: string; relation_type: string }>;
}

export interface PostprocessOutput extends PostprocessInput {
  warnings: string[];
}

const SYMMETRIC = new Set(['EASILY_CONFUSED_WITH', 'SYNONYM_OF']);

export function postprocess(input: PostprocessInput): PostprocessOutput {
  const warnings: string[] = [];
  const nodes = [...input.nodes];
  const relations = [...input.relations];

  // (1) 自动补 NEXT_STEP
  // 找每个 operation_process → 它的 HAS_STEP 子节点列表 → 按 step_order 排序 → 串成链
  const procIds = nodes.filter((n) => n.node_type === 'operation_process').map((n) => n.node_id);
  const existingNextStep = new Set(
    relations
      .filter((r) => r.relation_type === 'NEXT_STEP')
      .map((r) => `${r.source_id}->${r.target_id}`),
  );

  for (const procId of procIds) {
    const stepIds = relations
      .filter((r) => r.source_id === procId && r.relation_type === 'HAS_STEP')
      .map((r) => r.target_id);
    const steps = stepIds
      .map((id) => nodes.find((n) => n.node_id === id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n) && n!.node_type === 'operation_step')
      .map((n) => ({
        id: n.node_id,
        order: typeof n.tags?.step_order === 'number' ? n.tags.step_order : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.order - b.order);

    for (let i = 0; i < steps.length - 1; i++) {
      const key = `${steps[i].id}->${steps[i + 1].id}`;
      if (!existingNextStep.has(key)) {
        relations.push({
          source_id: steps[i].id,
          target_id: steps[i + 1].id,
          relation_type: 'NEXT_STEP',
          confidence: 0.9,
          description: 'auto-filled by postprocessor based on step_order',
        } as any);
        existingNextStep.add(key);
      }
    }
  }

  // (2) 对称关系去重（保留先出现的一条）
  const seenPairs = new Set<string>();
  const dedupedRelations = relations.filter((r) => {
    if (!SYMMETRIC.has(r.relation_type)) return true;
    const [a, b] = [r.source_id, r.target_id].sort();
    const key = `${r.relation_type}:${a}|${b}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  // (3) RELATED_TO 占比检查
  const totalRel = dedupedRelations.length;
  const relatedTo = dedupedRelations.filter((r) => r.relation_type === 'RELATED_TO').length;
  if (totalRel > 0 && relatedTo / totalRel > 0.1) {
    warnings.push(
      `RELATED_TO 占比 ${(relatedTo / totalRel * 100).toFixed(1)}% 超过 10%（${relatedTo}/${totalRel}），考虑改用更精确的关系类型`,
    );
  }

  return { nodes, relations: dedupedRelations, warnings };
}
```

### Task B.5：让 ai.orchestrator 调用 postprocessor

[ai.orchestrator.ts](../../backend/src/modules/ai/ai.orchestrator.ts) 在 `mapLLMOutput(output)` 之后插入：

```ts
import { postprocess } from './postprocessor.js';

// ...
const mapped: MappedCandidates = mapLLMOutput(output);
const post = postprocess({ nodes: mapped.nodes as any, relations: mapped.relations as any });
// 把 warnings 串到 ai_generation_logs 的 error_msg 末尾（仍然是 success，但带 warnings）
const warningSuffix = post.warnings.length ? `\n[postprocessor warnings]\n${post.warnings.join('\n')}` : '';

const createdNodes = await this.nodeService.bulkCreate(input.graphId, post.nodes, defaults);
const createdRelations = await this.relationService.bulkCreate(input.graphId, post.relations, defaults);

await this.prisma.aiGenerationLog.update({
  where: { id: logId },
  data: {
    status: 'success',
    prompt_used: prompt,
    llm_response: raw,
    nodes_created: createdNodes.length,
    relations_created: createdRelations.length,
    error_msg: warningSuffix || null,
  },
});
```

### Task B.6：让 ai.mapper 把 relation 扩展字段透传到 tags，relation.service 接收 tags

ai.mapper.ts 的 relation 循环改成：

```ts
const RELATION_DB_COLUMNS = new Set([
  'source_id',
  'target_id',
  'relation_type',
  'description',
  'confidence',
  'source',
  'ai_job_id',
]);

for (const r of parsed.relations) {
  if (dropDangling) {
    if (!knownNodeIds.has(r.source_id) || !knownNodeIds.has(r.target_id)) continue;
  }
  const known: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined) continue;
    if (RELATION_DB_COLUMNS.has(k)) known[k] = v;
    else extras[k] = v;
  }
  const item: RelationCreateInput = {
    ...(known as any),
    tags: extras, // direction_explanation / reason / evidence 等都进来
  } as any;
  relations.push(item);
}
```

[relation.service.ts](../../backend/src/modules/relations/relation.service.ts)：

- `RelationCreateInput`（如果在 shared 包中定义）增加 `tags?: Record<string, unknown>` 可选字段。
- PG 实现 `createBatch` 在 prisma 调用里把 `tags: input.tags ?? {}` 传进去。
- Neo4j 实现把 tags 序列化为 JSON 字符串挂在边属性 `tags_json`（或后续步骤再处理；本期不强求 Neo4j 端，只保证 PG 后端正确）。

### Task B.7：跑全部测试

```powershell
cd backend
pnpm vitest run src/modules/ai/ src/modules/relations/
```
预期：postprocessor + mapper + orchestrator 既有测试 + relation.service 全部 PASS。

### Task B.8：提交

```powershell
git add backend/src/modules/ai/ backend/src/modules/relations/ backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(ai): postprocessor + relations.tags for NEXT_STEP/dedup/RELATED_TO cap" --no-verify
```

---

## Slice C：前端按关系类型分样式 + 新节点类型颜色（owner: subagent-C，预计 1.5 天）

**Goal:** 前端节点颜色支持新 5 个 NodeType；边按 relation_type 分线型/颜色/可见性（**通过 cytoscape stylesheet selectors 实现，本项目用的是 cytoscape，不是 React Flow**）；NodeForm/NodePanel 兼容 `tags` 从 array 到 object 的过渡；旧测试 fixtures 同步迁移。

**Files:**
- Modify: [frontend/src/components/GraphEditor/nodeColors.ts](../../frontend/src/components/GraphEditor/nodeColors.ts)
- Create: `frontend/src/components/GraphEditor/edgeStyles.ts`（导出的是 cytoscape stylesheet 数组，不是 React Flow style 对象）
- Create: `frontend/src/components/GraphEditor/tags.ts`（asTagsObject helper）
- Modify: [frontend/src/components/GraphEditor/GraphCanvas.tsx](../../frontend/src/components/GraphEditor/GraphCanvas.tsx)（在 cytoscape `style` 数组里追加按 relation_type 的 selector；并在 elements 构造时把 relation_type 写进 edge.data 以便 selector 命中）
- Modify: [frontend/src/components/GraphEditor/NodeForm.tsx](../../frontend/src/components/GraphEditor/NodeForm.tsx)（用 asTagsObject）
- Modify: [frontend/src/components/NodePanel/NodePanel.tsx](../../frontend/src/components/NodePanel/NodePanel.tsx)（用 asTagsObject）
- Modify: 一批旧测试 fixtures，把 `tags: []` 与 `tags: ['cardio', ...]` 的断言改为 `tags: {}` / `tags: { _legacy: ['cardio', ...] }`（具体文件见下文 Task C.6）
- Create: `frontend/src/components/GraphEditor/__tests__/edgeStyles.test.ts`
- Create: `frontend/src/components/GraphEditor/__tests__/tags.test.ts`

### Task C.1：写 edgeStyles 纯函数测试

`frontend/src/components/GraphEditor/__tests__/edgeStyles.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getEdgeStyle, isEdgeHiddenByDefault } from '../edgeStyles';

describe('getEdgeStyle', () => {
  it('returns red-ish solid for HAS_RISK', () => {
    const s = getEdgeStyle('HAS_RISK');
    expect(s.stroke.toLowerCase()).toMatch(/^#(ef|dc|f8|fb|fc|fd|fe)/);
    expect(s.strokeDasharray).toBeUndefined();
  });
  it('returns green-ish for HANDLED_BY', () => {
    const s = getEdgeStyle('HANDLED_BY');
    expect(s.stroke.toLowerCase()).toMatch(/^#(10|22|34|4a|65|6e)/);
  });
  it('returns dashed for PREREQUISITE_OF', () => {
    expect(getEdgeStyle('PREREQUISITE_OF').strokeDasharray).toBeTruthy();
  });
  it('falls back gracefully for unknown relation type', () => {
    const s = getEdgeStyle('FOO_BAR_UNKNOWN');
    expect(s.stroke).toBeTruthy();
  });
});

describe('isEdgeHiddenByDefault', () => {
  it('hides RELATED_TO', () => {
    expect(isEdgeHiddenByDefault('RELATED_TO')).toBe(true);
  });
  it('hides BELONGS_TO_GRAPH', () => {
    expect(isEdgeHiddenByDefault('BELONGS_TO_GRAPH')).toBe(true);
  });
  it('does not hide HAS_STEP / NEXT_STEP / HAS_RISK / HANDLED_BY', () => {
    for (const t of ['HAS_STEP', 'NEXT_STEP', 'HAS_RISK', 'HANDLED_BY']) {
      expect(isEdgeHiddenByDefault(t)).toBe(false);
    }
  });
});
```

### Task C.2：写 tags 兼容函数测试

`frontend/src/components/GraphEditor/__tests__/tags.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { asTagsObject } from '../tags';

describe('asTagsObject', () => {
  it('returns {} for legacy array shape', () => {
    expect(asTagsObject(['a', 'b'])).toEqual({});
  });
  it('returns {} for null/undefined', () => {
    expect(asTagsObject(null)).toEqual({});
    expect(asTagsObject(undefined)).toEqual({});
  });
  it('returns the object as-is when given an object', () => {
    const o = { step_order: 1, aliases: ['x'] };
    expect(asTagsObject(o)).toEqual(o);
  });
});
```

### Task C.3：运行确认失败

```powershell
cd frontend
pnpm vitest run src/components/GraphEditor/__tests__/edgeStyles.test.ts src/components/GraphEditor/__tests__/tags.test.ts
```
预期：FAIL（模块不存在）。

### Task C.4：实现 edgeStyles.ts（兼容 cytoscape，输出 stylesheet selectors）

`getEdgeStyle` 与 `isEdgeHiddenByDefault` 仍以纯函数形式存在（满足 Task C.1 测试），但**主要消费方是 cytoscape stylesheet**。新增一个 `buildEdgeStylesheet()` 直接产出可拼进 GraphCanvas `style: [...]` 的对象数组。

```ts
import type { RelationType } from '@mkg/shared';

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

const STYLES: Partial<Record<RelationType, EdgeStyle>> = {
  // 教材结构 — 灰
  HAS_CHAPTER:         { stroke: '#9CA3AF', strokeWidth: 1.5 },
  HAS_SECTION:         { stroke: '#9CA3AF', strokeWidth: 1.5 },
  HAS_KNOWLEDGE_POINT: { stroke: '#6B7280', strokeWidth: 1.5 },
  CONTAINS:            { stroke: '#9CA3AF', strokeWidth: 1.5 },
  BELONGS_TO:          { stroke: '#9CA3AF', strokeWidth: 1.5 },

  // 操作流程 — 蓝/橙实线
  HAS_PROCESS:         { stroke: '#1E40AF', strokeWidth: 2 },
  HAS_STEP:            { stroke: '#2563EB', strokeWidth: 2 },
  NEXT_STEP:           { stroke: '#3B82F6', strokeWidth: 2.5 },

  // 前置 — 紫色虚线
  PREREQUISITE_OF:     { stroke: '#7C3AED', strokeWidth: 2, strokeDasharray: '6 4' },

  // 风险/错误 — 红/橙
  HAS_RISK:            { stroke: '#EF4444', strokeWidth: 2 },
  COMMON_ERROR_OF:     { stroke: '#F97316', strokeWidth: 1.5, strokeDasharray: '2 2' },
  MANIFESTED_AS:       { stroke: '#FB923C', strokeWidth: 1.5 },

  // 处理/预防 — 绿
  HANDLED_BY:          { stroke: '#10B981', strokeWidth: 2 },
  PREVENTED_BY:        { stroke: '#059669', strokeWidth: 2, strokeDasharray: '4 4' },

  // 易混 — 双向暗示，黄色
  EASILY_CONFUSED_WITH:{ stroke: '#F59E0B', strokeWidth: 1.5, strokeDasharray: '3 3' },

  // 教学应用 — 紫
  SUPPORTS_COMPETENCY: { stroke: '#A855F7', strokeWidth: 1.5 },
  ASSESSED_BY:         { stroke: '#C084FC', strokeWidth: 1.5 },
  TESTED_BY:           { stroke: '#C084FC', strokeWidth: 1.5, strokeDasharray: '4 2' },
  APPLIED_IN:          { stroke: '#C084FC', strokeWidth: 1.5 },

  // 术语 — 青
  HAS_TERM:            { stroke: '#06B6D4', strokeWidth: 1.5 },
  ALIAS_OF:            { stroke: '#22D3EE', strokeWidth: 1, strokeDasharray: '2 2' },
  STANDARD_TERM_OF:    { stroke: '#06B6D4', strokeWidth: 1.5 },
  SYNONYM_OF:          { stroke: '#22D3EE', strokeWidth: 1, strokeDasharray: '2 2' },

  // 资源 — 灰
  ILLUSTRATED_BY:      { stroke: '#94A3B8', strokeWidth: 1 },
  DESCRIBED_IN:        { stroke: '#94A3B8', strokeWidth: 1 },

  // 弱关联/图谱归属 — 默认隐藏
  RELATED_TO:          { stroke: '#D1D5DB', strokeWidth: 1, strokeDasharray: '1 3' },
  BELONGS_TO_GRAPH:    { stroke: '#E5E7EB', strokeWidth: 0.5 },
  MERGED_INTO:         { stroke: '#E5E7EB', strokeWidth: 0.5 },
  RELATED_GRAPH:       { stroke: '#E5E7EB', strokeWidth: 0.5 },
};

const FALLBACK: EdgeStyle = { stroke: '#6B7280', strokeWidth: 1.5 };
const HIDDEN_BY_DEFAULT = new Set<string>(['RELATED_TO', 'BELONGS_TO_GRAPH']);

export function getEdgeStyle(t: RelationType | string): EdgeStyle {
  return (STYLES as Record<string, EdgeStyle>)[t] ?? FALLBACK;
}

export function isEdgeHiddenByDefault(t: RelationType | string): boolean {
  return HIDDEN_BY_DEFAULT.has(t);
}

/**
 * 把上面的 STYLES 表渲染为 cytoscape stylesheet selector 数组，
 * 供 GraphCanvas 在 cytoscape({ style: [...baseStyle, ...buildEdgeStylesheet()] }) 里使用。
 *
 * 每条 selector 形如 `edge[relation_type = "HAS_RISK"]`，命中由 GraphCanvas 在
 * elements 构造时往 edge.data.relation_type 写入的字段。
 */
export function buildEdgeStylesheet(): Array<{ selector: string; style: Record<string, unknown> }> {
  const out: Array<{ selector: string; style: Record<string, unknown> }> = [];
  for (const [relType, s] of Object.entries(STYLES)) {
    if (!s) continue;
    const style: Record<string, unknown> = {
      'line-color': s.stroke,
      'target-arrow-color': s.stroke,
      width: s.strokeWidth,
    };
    if (s.strokeDasharray) {
      style['line-style'] = 'dashed';
      // cytoscape 支持 line-dash-pattern: [on, off]
      const parts = s.strokeDasharray.split(/\s+/).map(Number).filter((x) => !Number.isNaN(x));
      if (parts.length >= 2) style['line-dash-pattern'] = parts.slice(0, 2);
    }
    out.push({ selector: `edge[relation_type = "${relType}"]`, style });
  }
  // 默认隐藏的关系类型再追加 visibility:hidden（用户在筛选面板勾选才显示）
  for (const t of HIDDEN_BY_DEFAULT) {
    out.push({
      selector: `edge[relation_type = "${t}"][!showHidden]`,
      style: { display: 'none' },
    });
  }
  return out;
}
```

### Task C.5：实现 tags.ts

```ts
export function asTagsObject(tags: unknown): Record<string, unknown> {
  if (tags === null || tags === undefined) return {};
  if (Array.isArray(tags)) return {};
  if (typeof tags === 'object') return tags as Record<string, unknown>;
  return {};
}
```

### Task C.6：扩充 nodeColors.ts

把新 NodeType 加进 `NODE_COLORS` / `NODE_TYPE_LABELS`，把新 RelationType 加进 `RELATION_TYPE_LABELS`。完整内容：

```ts
import type { NodeType, RelationType } from '@mkg/shared';

export const NODE_COLORS: Record<NodeType, string> = {
  textbook: '#1E40AF',
  chapter: '#2563EB',
  section: '#3B82F6',
  knowledge_point: '#3B82F6',
  term: '#10B981',
  operation_process: '#0EA5E9',
  operation_step: '#F59E0B',
  competency: '#8B5CF6',
  risk: '#EF4444',
  error: '#F97316',
  measure: '#10B981',
  assessment_item: '#A855F7',
  image: '#EC4899',
  table: '#06B6D4',
  question: '#EF4444',
  case: '#92400E',
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  textbook: '教材',
  chapter: '章',
  section: '节',
  knowledge_point: '知识点',
  term: '术语',
  operation_process: '操作流程',
  operation_step: '操作步骤',
  competency: '能力',
  risk: '风险',
  error: '常见错误',
  measure: '处理措施',
  assessment_item: '评分项',
  image: '图像',
  table: '表格',
  question: '题目',
  case: '病例',
};

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  CONTAINS: '包含',
  BELONGS_TO: '属于',
  HAS_CHAPTER: '含章',
  HAS_SECTION: '含节',
  HAS_KNOWLEDGE_POINT: '含知识点',
  HAS_PROCESS: '含流程',
  HAS_STEP: '含步骤',
  NEXT_STEP: '下一步',
  PREREQUISITE_OF: '前置',
  EASILY_CONFUSED_WITH: '易混',
  RELATED_TO: '相关',
  ILLUSTRATED_BY: '图示',
  DESCRIBED_IN: '描述于',
  TESTED_BY: '考核',
  APPLIED_IN: '应用于',
  STANDARD_TERM_OF: '标准术语',
  SYNONYM_OF: '同义',
  HAS_TERM: '含术语',
  ALIAS_OF: '别名',
  SUPPORTS_COMPETENCY: '支撑能力',
  ASSESSED_BY: '评分项',
  HAS_RISK: '风险',
  HANDLED_BY: '处理',
  PREVENTED_BY: '预防',
  MANIFESTED_AS: '表现为',
  COMMON_ERROR_OF: '常见错误',
  BELONGS_TO_GRAPH: '属于图谱',
  MERGED_INTO: '合并到',
  RELATED_GRAPH: '相关图谱',
};

export const CANDIDATE_BORDER = '2px dashed #9CA3AF';
export const APPROVED_BORDER = '2px solid #111827';
```

### Task C.7：在 GraphCanvas 用上边样式

打开 [GraphCanvas.tsx](../../frontend/src/components/GraphEditor/GraphCanvas.tsx)，先 Read 全文确认 elements 与 cytoscape 初始化的当前结构（约 100-220 行），再做最小修改：

**(1) elements 构造时把 `relation_type` 写进 `edge.data`**（约第 118-130 行）：

```ts
for (const r of relations) {
  if (!r.relation_id) continue;
  els.push({
    group: 'edges',
    data: {
      id: r.relation_id,
      source: r.source_id,
      target: r.target_id,
      label: RELATION_TYPE_LABELS[r.relation_type] ?? r.relation_type,
      status: r.status,
      relation_type: r.relation_type, // ← 新增：让 selector 命中
    },
  });
}
```

**(2) `cytoscape({ ..., style: [...] })` 末尾追加按 relation_type 的 selector 数组**（约第 157-220 行）：

```ts
import { buildEdgeStylesheet } from './edgeStyles';

// ...
style: [
  // ...原有 node / candidate / selected / edge 默认 selectors 保留不动...
  ...buildEdgeStylesheet(),
],
```

> 不要改原有的 `selector: 'edge'` 默认样式——它作为 fallback 用于本期未识别的 relation_type。`buildEdgeStylesheet()` 返回的 selectors 优先级在默认 `'edge'` 之后（cytoscape 后定义的覆盖前定义的），命中时会替换 line-color / width / line-style 等。

> 实际写法以现有 `GraphCanvas.tsx` 为准；执行 subagent 必须先 Read 该文件。

### Task C.7.5：NodeForm / NodePanel 兼容 tags 对象形态

[NodeForm.tsx](../../frontend/src/components/GraphEditor/NodeForm.tsx) 第 37、58、72 行以及 [NodePanel.tsx](../../frontend/src/components/NodePanel/NodePanel.tsx) 第 37-38 行当前用 `(tags ?? []).join(', ')` / `tags.split(',').map(...)`，假设 tags 是字符串数组。

替换策略：

```ts
import { asTagsObject } from '../GraphEditor/tags';   // 路径按 import 调整

// 显示 tags（JSON 形态友好显示，且兼容历史 _legacy 数组）
const tagsObj = asTagsObject(node?.tags);
const legacyChips = Array.isArray(tagsObj._legacy) ? (tagsObj._legacy as string[]) : [];
const v2Pairs = Object.entries(tagsObj).filter(([k]) => k !== '_legacy');

// 渲染：把 legacyChips 当 chip 显示；v2Pairs 用 key: value 列表显示
```

NodeForm 的"输入 chips、保存"那条路径（用户手工编辑标签）保持原行为：把用户输入的数组写入 `tags._legacy`：

```ts
// 提交时
const submittedTags = {
  ...(asTagsObject(initial?.tags)),
  _legacy: chipsArray, // 用户输入的字符串数组
};
```

> 即"v2 字段（step_order、aliases 等）只读展示，不在 NodeForm 表单里编辑；用户编辑的 chips 落进 `_legacy` 子键"。如果 NodeForm 当前还有 `Array.isArray` 判断，把分支去掉。

### Task C.7.6：迁移旧测试 fixtures

把以下文件中 `tags: []` / `tags: ['cardio', 'vital']` 类断言/构造改为 `tags: {}` / `tags: { _legacy: ['cardio', 'vital'] }`：

- `frontend/src/components/GraphEditor/__tests__/NodeForm.test.tsx`
- `frontend/src/components/NodePanel/__tests__/NodePanel.test.tsx`
- `frontend/src/components/ReviewPanel/__tests__/ReviewPanel.test.tsx`
- `frontend/src/stores/__tests__/stores.test.ts`
- `frontend/src/pages/__tests__/GraphEditorPage.test.tsx`

```powershell
cd frontend
pnpm vitest run src/components/GraphEditor/__tests__ src/components/NodePanel/__tests__ src/components/ReviewPanel/__tests__ src/stores/__tests__ src/pages/__tests__/GraphEditorPage.test.tsx
```
预期：全部 PASS。

### Task C.8：跑测试 + tsc

```powershell
cd frontend
pnpm vitest run src/components/GraphEditor/
pnpm tsc --noEmit
```
预期：测试 PASS、`tsc --noEmit` 通过（这是检查 NodeType/RelationType 穷举 Record 是否补齐的最关键手段）。

### Task C.9：提交

```powershell
git add frontend/src/components/GraphEditor/
git commit -m "feat(graph-editor): per-relation-type edge styles + new node types" --no-verify
```

---

## Slice D：学习路径走多关系类型（owner: subagent-D，预计 1 天）

**Goal:** 让 `learningService.getPath(node_id)` 不仅遍历 `PREREQUISITE_OF`，也遍历 `HAS_STEP / NEXT_STEP`，从而支持"目标是 operation_step → 学习路径自动展开为有序步骤"。

**Files:**
- Modify: [backend/src/modules/learning/learning.service.ts](../../backend/src/modules/learning/learning.service.ts)
- Modify: [backend/src/modules/learning/__tests__/learning.service.test.ts](../../backend/src/modules/learning/__tests__/learning.service.test.ts)

### Task D.1：写新行为的失败测试

> ⚠️ 现有 `learning.service.ts` 导出的方法名是 `LearningService.learningPath(node_id, q)`（不是 `getPath`），`q` 的类型是 `{ depth: number }`（不是 `{ graph_id: string }`）。当前递归 CTE **没有** 按 graph_id 过滤——这是已有契约，本期保持不变（多图谱在生产里少见跨图查询，后续要做时再加 graph_id 列）。

在 `learning.service.test.ts` 末尾追加：

```ts
import { LearningService } from '../learning.service';

describe('learning path with operation flow relations (v2)', () => {
  it('walks NEXT_STEP backwards from a target step', async () => {
    const gid = 'g_op_1';
    await prisma.graph.create({
      data: { graph_id: gid, graph_name: 'op', graph_type: 'course' },
    });
    for (const id of ['s1', 's2', 's3', 's4']) {
      await prisma.node.create({
        data: {
          node_id: id,
          graph_id: gid,
          node_type: 'operation_step',
          name: id,
          status: 'approved',
          tags: { step_order: Number(id.slice(1)) },
        },
      });
    }
    for (const [s, t] of [['s1', 's2'], ['s2', 's3'], ['s3', 's4']]) {
      await prisma.relation.create({
        data: {
          graph_id: gid,
          source_id: s,
          target_id: t,
          relation_type: 'NEXT_STEP',
          status: 'approved', // CTE 只走 approved
        },
      });
    }
    const r = await LearningService.learningPath('s4', { depth: 6 });
    expect(r?.path.map((p) => p.node_id)).toEqual(['s1', 's2', 's3']);
  });

  it('walks HAS_STEP from operation_process to its first step', async () => {
    const gid = 'g_op_2';
    await prisma.graph.create({
      data: { graph_id: gid, graph_name: 'op2', graph_type: 'course' },
    });
    await prisma.node.create({
      data: { node_id: 'proc1', graph_id: gid, node_type: 'operation_process', name: 'p', status: 'approved' },
    });
    await prisma.node.create({
      data: { node_id: 'st1', graph_id: gid, node_type: 'operation_step', name: 's1', status: 'approved', tags: { step_order: 1 } },
    });
    await prisma.relation.create({
      data: { graph_id: gid, source_id: 'proc1', target_id: 'st1', relation_type: 'HAS_STEP', status: 'approved' },
    });
    const r = await LearningService.learningPath('st1', { depth: 6 });
    expect(r?.path.map((p) => p.node_id)).toContain('proc1');
  });

  it('mixes PREREQUISITE_OF and NEXT_STEP', async () => {
    const gid = 'g_mix';
    await prisma.graph.create({
      data: { graph_id: gid, graph_name: 'mix', graph_type: 'course' },
    });
    await prisma.node.createMany({
      data: [
        { node_id: 'kp1', graph_id: gid, node_type: 'knowledge_point', name: 'kp1', status: 'approved' },
        { node_id: 'sm1', graph_id: gid, node_type: 'operation_step', name: 's1', status: 'approved' },
        { node_id: 'sm2', graph_id: gid, node_type: 'operation_step', name: 's2', status: 'approved' },
      ],
    });
    await prisma.relation.createMany({
      data: [
        { graph_id: gid, source_id: 'kp1', target_id: 'sm1', relation_type: 'PREREQUISITE_OF', status: 'approved' },
        { graph_id: gid, source_id: 'sm1', target_id: 'sm2', relation_type: 'NEXT_STEP', status: 'approved' },
      ],
    });
    const r = await LearningService.learningPath('sm2', { depth: 6 });
    const ids = r?.path.map((p) => p.node_id) ?? [];
    expect(ids).toEqual(['kp1', 'sm1']);
  });

  it('does not break the existing PREREQUISITE_OF-only chain', async () => {
    const gid = 'g_legacy_v2';
    await prisma.graph.create({
      data: { graph_id: gid, graph_name: 'legacy', graph_type: 'course' },
    });
    await prisma.node.createMany({
      data: [
        { node_id: 'aa', graph_id: gid, node_type: 'knowledge_point', name: 'a', status: 'approved' },
        { node_id: 'bb', graph_id: gid, node_type: 'knowledge_point', name: 'b', status: 'approved' },
      ],
    });
    await prisma.relation.create({
      data: { graph_id: gid, source_id: 'aa', target_id: 'bb', relation_type: 'PREREQUISITE_OF', status: 'approved' },
    });
    const r = await LearningService.learningPath('bb', { depth: 5 });
    expect(r?.path[0]?.node_id).toBe('aa');
    expect(r?.path[0]?.via).toBe('PREREQUISITE_OF');
  });
});
```

### Task D.2：运行测试确认失败

```powershell
cd backend
pnpm vitest run src/modules/learning/__tests__/learning.service.test.ts
```
预期：3 条新 case FAIL，第 4 条 PASS（防回归）。

### Task D.3：扩展 learning.service 走多关系

打开 [learning.service.ts](../../backend/src/modules/learning/learning.service.ts) 的 `learningPath` 函数（约第 44-82 行）。当前两处硬编码 `r.relation_type = 'PREREQUISITE_OF'`（约第 60、69 行）。

**改造方式**：直接把字符串字面量改为 IN 列表。由于该函数用 `prisma.$queryRaw` 模板字符串，最简单的写法是把数组用 `Prisma.sql` 拼接：

```ts
import { Prisma } from '@prisma/client';

const PATH_RELATION_TYPES = [
  'PREREQUISITE_OF',
  'HAS_STEP',
  'NEXT_STEP',
] as const;

// ... 在 learningPath 内部：
const types = Prisma.sql`(${Prisma.join(PATH_RELATION_TYPES.map((t) => Prisma.sql`${t}`))})`;

const rows = await prisma.$queryRaw<Array<LearningPathStep>>`
  WITH RECURSIVE prereqs AS (
    SELECT n.node_id, n.name, 1 AS depth, r.relation_type AS via
    FROM relations r
    JOIN nodes n ON n.node_id = r.source_id
    WHERE r.target_id = ${node_id}
      AND r.relation_type IN ${types}
      AND r.status = 'approved'

    UNION

    SELECT n.node_id, n.name, p.depth + 1 AS depth, r.relation_type AS via
    FROM prereqs p
    JOIN relations r ON r.target_id = p.node_id
    JOIN nodes n ON n.node_id = r.source_id
    WHERE r.relation_type IN ${types}
      AND r.status = 'approved'
      AND p.depth < ${q.depth}::int
  )
  SELECT DISTINCT ON (node_id) node_id, name, depth, via
  FROM prereqs
  ORDER BY node_id, depth ASC
`;
```

> ⚠️ **`knowledgeGap` 函数也有 `PREREQUISITE_OF` 硬编码**（约第 136、145 行）。本期 Slice D **不动它**——`knowledgeGap` 的语义是"我学这些目标还差什么前置"，按操作流程链反推作业意义不明，等需求清晰再扩。提交注释里写一行 `NOTE: knowledgeGap retains PREREQUISITE_OF-only by design`。

> Neo4j 后端的 `[:PREREQUISITE_OF*1..N]` Cypher 同样需要改成 `[:PREREQUISITE_OF|HAS_STEP|NEXT_STEP*1..N]`。如果 LearningService 当前没有 Neo4j 实现路径（项目已在 commit `d119cb9` 完成 PG 切换），跳过；如果有，比照 PG 改造。

### Task D.4：运行测试确认通过

```powershell
pnpm vitest run src/modules/learning/__tests__/learning.service.test.ts
```
预期：全部 PASS。

### Task D.5：检查路由层是否需要透出新字段

[learning.routes.test.ts](../../backend/src/modules/learning/__tests__/learning.routes.test.ts) 看返回 schema，每个 path 节点的 `via` 字段现在可能取值 `PREREQUISITE_OF / HAS_STEP / NEXT_STEP`——确认 zod response schema 没有把 `via` 限定为字面量 `'PREREQUISITE_OF'`。如果限定了，放宽为 `RelationType` 即可。

```powershell
pnpm vitest run src/modules/learning/__tests__/learning.routes.test.ts
```

### Task D.6：提交

```powershell
git add backend/src/modules/learning/
git commit -m "feat(learning): walk PREREQUISITE_OF + HAS_STEP + NEXT_STEP" --no-verify
```

---

# Phase 1 收尾与验收

由主控（用户或一个收口 subagent）执行：

```powershell
# 全量回归
pnpm -r vitest run
pnpm -r tsc --noEmit
cd backend; pnpm prisma migrate status
```

**手动 e2e（用户自己跑，sub-agent 不要后台拉 dev server，遵循 [No background dev servers](../../C:/Users/Administrator/.claude/projects/c--ClaudeCode-20260517-TextBookRagAndKnowledgeGraph/memory/feedback_no_background_dev_servers.md)）：**

1. `start.bat` 启动；登录 → 选 v2 模板 → 填一段静脉输液正文 → 生成图谱；
2. 期望：
   - 出现 `operation_process` + `operation_step` 链；
   - 出现 `risk / measure / error` 节点；
   - 边按关系类型显示不同颜色；`RELATED_TO` 默认隐藏；
   - 操作流程相邻步骤之间出现 `NEXT_STEP`（由后处理器自动补）；
   - 在 `operation_step` 上点学习路径，能看到按步骤回溯的有序节点列表；
   - `Node.tags` 中有 `step_order / aliases / standard_term / evidence` 等扩展字段；
   - `Relation.tags` 中有 `reason / direction_explanation` 字段（对 v2 输出）。

**Phase 1 验收清单：**
- [ ] 全部测试 PASS
- [ ] AI 生成的图谱实际包含至少 1 个 risk + 1 个 error + 1 个 measure（针对操作类教材片段）
- [ ] NEXT_STEP 由后处理器自动生成且方向正确
- [ ] RELATED_TO 占比 > 10% 时 `quality_report.warnings` 出现告警
- [ ] 前端按关系类型显示了不同样式
- [ ] 学习路径在选中 operation_step 时返回正确顺序
- [ ] `pnpm tsc --noEmit` 全包通过

---

# 与 ChatGPT 原建议的差异（决策记录）

| ChatGPT 建议 | 本计划处理 | 原因 |
|---|---|---|
| `evidence_chunk` 节点类型 + chunks 表 | **不做** | 用户明确不做 RAG/向量库；evidence 改为轻量 `tags.evidence` 字段 |
| 每个核心节点输出 `embedding_text` | **不做** | 同上 |
| `terms` 单独表、`media_images` / `media_tables` 单独表 | **不做** | YAGNI；`tags` 字段足够，等真有跨图谱术语查询需求再抽 |
| `graph_generation_jobs` 单独表 | **不做** | 已有 `ai_generation_logs`；`prompt_version` 可放进 `error_msg` 之外的扩展字段或后续单加列 |
| 强 JSON Schema 校验（数十字段强制必填） | **不做** | 当前只在提示词里硬约束 + 后处理器告警；遇到模型抖动再加校验，避免单字段缺失就让整 job 失败 |
| `PREVIOUS_STEP` 关系 | **不做** | ChatGPT 自己也说"程序反推即可"——同意 |
| 学习路径算法重写为 6 层 | **本期只做"走多关系"** | 数据先长出来，分层 UI 留给后续 |
| 自动生成 HAS_CHAPTER / HAS_SECTION（程序补） | **本期由 LLM 直接输出** | seed.ts 提示词层级很简单，直接让 LLM 写更省事；后处理器只负责 NEXT_STEP |

---

# 风险与回滚

| 风险 | 检测信号 | 回滚 |
|---|---|---|
| Phase 0 解除 NODE_COLUMNS 影响既有 node 写入 | `node.service` 现存测试红 | revert Task 0.2 实现，单独修测试再重做 |
| `prisma migrate dev` 误删 hnsw 索引 | `\d nodes` 没有 `nodes_embedding_idx` | 手工 `CREATE INDEX nodes_embedding_idx ON nodes USING hnsw (embedding vector_cosine_ops);` 并把同样语句加进迁移 SQL 末尾 |
| 提示词 v2 让 LLM 输出 token 暴涨 | `ai_generation_logs.llm_response` 长度翻倍以上 | 缩短系统提示词的"扩展字段说明"块，移到 user_prompt |
| 后处理器误增 NEXT_STEP（重复） | postprocessor 单测应已防住 | 加更严格的"已存在则跳过"判断 |
| 前端 Record 类型穷举编译失败 | `pnpm tsc` 报错 | 确认 `nodeColors.ts` 与 `enums.ts` 同步 |
| `tags` 由 array 变 object 让前端旧代码崩 | UI 列表空白或异常 | 走 Slice C 的 `asTagsObject` 兼容函数 |
| Slice 之间合并冲突 | git merge 报错 | 文件归属表已严格分区，理论上不会冲突；若发生说明边界被破坏，回到当前计划查文件归属 |

---

# subagent 派发约定（必读）

每个 Slice 派发时给 subagent 的提示词必须包含：

1. **本计划绝对路径**：`c:\ClaudeCode\20260517 TextBookRagAndKnowledgeGraph\docs\plans\2026-05-21-medical-kg-v2-prompts-and-relations.md`
2. **明确的边界**：只能改本 Slice"Files"区列出的文件；如需读其它文件可以读，但写改动一律拒绝；
3. **Phase 0 已完成的假设**：subagent 启动时假定枚举已扩、`NODE_COLUMNS` 已扩、mapper 已透传 tags、`relations.tags` 已加列。如果发现该假设不成立，**立即停下来报告**，不要"顺手"重做 Phase 0；
4. **commit 时必须 `--no-verify`**（项目记忆：Husky on Windows 坏）；
5. **完成后 `git status` 自检不留未提交改动**（项目记忆：sub-agent leaves changes uncommitted）；
6. **不要切分支**——全部在当前工作分支 `feature/graph-editor-zoom-edge-edit-path-focus` 提交；
7. **禁止 PowerShell 做文件 IO**（读写中文文件会按 GBK 解码 UTF-8 导致乱码）——一律用 Read/Write/Edit 工具；
8. **禁止后台拉 dev server**（`start.bat / pnpm dev` 等让用户自己跑）；
9. 全部测试 PASS 才算完成；不允许跳过失败测试，不允许 `it.skip`；
10. **不要执行迁移**（`prisma migrate dev`）—— Slice B 的迁移由主控统一审 SQL 后再跑，避免多个 subagent 并行迁移污染开发库。Slice B 的 subagent 写完 schema.prisma 改动 + 迁移目录占位说明即可；实际迁移命令由用户确认后手动执行。

---

# 文件归属对照表（再次重申，给 subagent 参考）

任何超出本表"✍ 写"列的文件，subagent 必须**只读不写**。

| Slice | ✍ 可写文件 |
|---|---|
| Phase 0 | `shared/src/enums.ts` / `shared/src/__tests__/enums.test.ts` / `backend/prisma/schema.prisma` / `backend/prisma/migrations/<新>/migration.sql` / `backend/src/modules/nodes/node.service.ts`（NODE_COLUMNS 扩展）/ `backend/src/modules/nodes/__tests__/*` / `backend/src/modules/ai/ai.mapper.ts`（透传扩展字段进 tags）|
| Slice A | `backend/prisma/seed.ts` / `backend/prisma/__tests__/seed.template.test.ts` |
| Slice B | `backend/src/modules/ai/postprocessor.ts`（新）/ `backend/src/modules/ai/__tests__/postprocessor.test.ts`（新）/ `backend/src/modules/ai/ai.orchestrator.ts`（在 bulkCreate 前加钩子）/ `backend/src/modules/ai/ai.mapper.ts`（仅追加 relation 折叠 tags 段，node 段已由 Phase 0 完成）/ `backend/src/modules/relations/__tests__/*` |
| Slice C | `frontend/src/components/GraphEditor/nodeColors.ts` / `frontend/src/components/GraphEditor/edgeStyles.ts`（新）/ `frontend/src/components/GraphEditor/tags.ts`（新）/ `frontend/src/components/GraphEditor/GraphCanvas.tsx` / `frontend/src/components/GraphEditor/NodeForm.tsx` / `frontend/src/components/NodePanel/NodePanel.tsx` / `frontend/src/components/GraphEditor/__tests__/*`（新文件 + 旧 fixtures 改断言）/ `frontend/src/components/NodePanel/__tests__/*`（fixtures）/ `frontend/src/components/ReviewPanel/__tests__/*`（fixtures）/ `frontend/src/stores/__tests__/*`（fixtures）/ `frontend/src/pages/__tests__/GraphEditorPage.test.tsx`（fixtures） |
| Slice D | `backend/src/modules/learning/learning.service.ts` / `backend/src/modules/learning/__tests__/*` |

> **唯一文件交叠点：`backend/src/modules/ai/ai.mapper.ts`。**Phase 0 改 `parsed.nodes.map(...)` 那段、写入 NODE_DB_COLUMNS 常量；Slice B 在文件其它位置追加 `parsed.relations` 折叠 extras 进 tags 的处理。两处改动不重叠，但 Slice B 启动前必须先 `git pull` 拿到 Phase 0 的最新代码。
>
> **schema.prisma 与 Prisma 迁移完全归 Phase 0 拥有**——Slice B 不要再跑 `prisma migrate dev`，不要再改 schema。Phase 0 Task 0.3 已经为 Relation 加好 `tags Json` 列。


