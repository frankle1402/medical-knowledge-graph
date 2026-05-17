# Agent-F — 共享契约 / 类型 / Schema 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 构建 `shared/` 工作区，集中维护设计文档中所有节点类型、关系类型、API 请求/响应 DTO 的 TypeScript 类型与 Zod Schema，并发布 OpenAPI 契约文档供前后端联调。

**架构（Architecture）:** `shared/` 是一个独立的 npm workspace，编译为 ESM + d.ts；前后端通过 `import { Node, NodeType } from '@mkg/shared'` 直接消费；`openapi.yaml` 由 zod-to-openapi 生成，作为前端 mock 与后端路由验证的唯一真理来源。

**技术栈:** TypeScript 5.5 · Zod 3.23 · `@asteasolutions/zod-to-openapi` · OpenAPI 3.1。

---

## 工作分支

`feature/agent-f-shared`

## 输出目录（仅本 Agent 可写）

- `shared/`
- `backend/openapi.yaml`（由 shared 生成）

## 关键依赖

- 等待 Agent-G 的 `Task 1-2` 完成（根 `package.json` 已含 workspaces）。

---

## Task 1：`shared/` 工作区骨架

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`

**Step 1：写 `shared/package.json`**

```json
{
  "name": "@mkg/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "openapi:gen": "tsx src/openapi/build.ts > ../backend/openapi.yaml"
  },
  "dependencies": {
    "zod": "3.23.8",
    "@asteasolutions/zod-to-openapi": "7.1.1"
  },
  "devDependencies": {
    "tsx": "4.16.5",
    "typescript": "5.5.4",
    "vitest": "2.0.5",
    "yaml": "2.5.0"
  }
}
```

**Step 2：写 `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

**Step 3：写空 `shared/src/index.ts`**

```ts
export {};
```

**Step 4：验证编译**

Run: `npm install; if ($?) { npm -w @mkg/shared run build }`
Expected: 生成 `shared/dist/index.js` 和 `shared/dist/index.d.ts`。

**Step 5：Commit**

```powershell
git add shared package.json package-lock.json
git commit -m "chore(agent-f): bootstrap shared workspace"
```

---

## Task 2：节点类型枚举 Schema（设计文档 §3.1）

**Files:**
- Create: `shared/src/enums.ts`
- Create: `shared/src/__tests__/enums.test.ts`

**Step 1：先写测试**

```ts
import { describe, it, expect } from 'vitest';
import { NodeType, KnowledgeType, Difficulty, Importance, RelationType } from '../enums';

describe('enums', () => {
  it('NodeType 包含设计文档定义的 11 种类型', () => {
    expect(NodeType.options).toEqual([
      'textbook', 'chapter', 'section', 'knowledge_point', 'term',
      'operation_step', 'competency', 'image', 'table', 'question', 'case',
    ]);
  });
  it('KnowledgeType 含 12 个枚举值', () => {
    expect(KnowledgeType.options.length).toBe(12);
    expect(KnowledgeType.options).toContain('异常处理类');
  });
  it('RelationType 含层级、知识、资源、术语、能力、归属六组', () => {
    expect(RelationType.options).toContain('CONTAINS');
    expect(RelationType.options).toContain('PREREQUISITE_OF');
    expect(RelationType.options).toContain('BELONGS_TO_GRAPH');
  });
  it('Difficulty 三档', () => {
    expect(Difficulty.options).toEqual(['基础', '中等', '较难']);
  });
  it('Importance 三档', () => {
    expect(Importance.options).toEqual(['高频考点', '重点掌握', '一般了解']);
  });
});
```

**Step 2：跑测试看失败**

Run: `npm -w @mkg/shared test`
Expected: FAIL — 模块不存在。

**Step 3：实现 `shared/src/enums.ts`**

```ts
import { z } from 'zod';

export const NodeType = z.enum([
  'textbook', 'chapter', 'section', 'knowledge_point', 'term',
  'operation_step', 'competency', 'image', 'table', 'question', 'case',
]);
export type NodeType = z.infer<typeof NodeType>;

export const KnowledgeType = z.enum([
  '概念类', '目的类', '适应证类', '禁忌证类', '操作流程类', '操作要点类',
  '注意事项类', '异常处理类', '并发症类', '观察护理类', '健康教育类', '考点类',
]);
export type KnowledgeType = z.infer<typeof KnowledgeType>;

export const Difficulty = z.enum(['基础', '中等', '较难']);
export type Difficulty = z.infer<typeof Difficulty>;

export const Importance = z.enum(['高频考点', '重点掌握', '一般了解']);
export type Importance = z.infer<typeof Importance>;

export const CompetencyLevel = z.enum(['核心能力', '基础能力', '支持能力']);
export type CompetencyLevel = z.infer<typeof CompetencyLevel>;

export const RelationType = z.enum([
  'CONTAINS', 'BELONGS_TO',
  'PREREQUISITE_OF', 'EASILY_CONFUSED_WITH', 'RELATED_TO',
  'ILLUSTRATED_BY', 'DESCRIBED_IN', 'TESTED_BY', 'APPLIED_IN',
  'STANDARD_TERM_OF', 'SYNONYM_OF',
  'SUPPORTS_COMPETENCY',
  'BELONGS_TO_GRAPH', 'MERGED_INTO', 'RELATED_GRAPH',
]);
export type RelationType = z.infer<typeof RelationType>;

export const NodeStatus = z.enum(['candidate', 'approved', 'rejected', 'archived']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const NodeSource = z.enum(['manual', 'ai_generated', 'imported']);
export type NodeSource = z.infer<typeof NodeSource>;

export const UserRole = z.enum(['admin', 'expert', 'operator', 'ai_service']);
export type UserRole = z.infer<typeof UserRole>;

export const GraphType = z.enum(['course', 'chapter', 'subject', 'custom']);
export type GraphType = z.infer<typeof GraphType>;
```

**Step 4：跑测试通过**

Run: `npm -w @mkg/shared test`
Expected: PASS。

**Step 5：Commit**

```powershell
git add shared/src/enums.ts shared/src/__tests__/enums.test.ts
git commit -m "feat(agent-f): add node/relation/role enums"
```

---

## Task 3：节点 Schema（基础字段 + 各类型扩展）

**Files:**
- Create: `shared/src/schemas/node.ts`
- Create: `shared/src/__tests__/node.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { BaseNode, KnowledgePointNode, TermNode } from '../schemas/node';

describe('node schemas', () => {
  it('BaseNode 必填字段', () => {
    const r = BaseNode.safeParse({ node_id: 'KP_1', node_type: 'knowledge_point', name: '静脉输液' });
    expect(r.success).toBe(true);
  });
  it('KnowledgePointNode 必含 knowledge_type', () => {
    const r = KnowledgePointNode.safeParse({
      node_id: 'KP_1', node_type: 'knowledge_point', name: '静脉输液', knowledge_type: '概念类',
    });
    expect(r.success).toBe(true);
  });
  it('KnowledgePointNode 缺 knowledge_type 应失败', () => {
    const r = KnowledgePointNode.safeParse({ node_id: 'KP_1', node_type: 'knowledge_point', name: 'x' });
    expect(r.success).toBe(false);
  });
  it('TermNode 必含 standard_term', () => {
    const r = TermNode.safeParse({
      node_id: 'T_1', node_type: 'term', name: 'IV', standard_term: '静脉注射', aliases: ['IV'],
    });
    expect(r.success).toBe(true);
  });
});
```

**Step 2：跑测试看失败**

Run: `npm -w @mkg/shared test`
Expected: FAIL。

**Step 3：实现 `shared/src/schemas/node.ts`**

```ts
import { z } from 'zod';
import {
  NodeType, KnowledgeType, Difficulty, Importance, CompetencyLevel,
  NodeStatus, NodeSource,
} from '../enums';

export const BaseNode = z.object({
  node_id: z.string().min(1),
  node_type: NodeType,
  name: z.string().min(1),
  status: NodeStatus.default('candidate'),
  confidence: z.number().min(0).max(1).default(1),
  source: NodeSource.default('manual'),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  ai_job_id: z.string().uuid().optional(), // 由 AI 生成时附带，便于审核 / 撤销按 job 批改
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  created_by: z.string().optional(),
});
export type BaseNode = z.infer<typeof BaseNode>;

export const TextbookNode = BaseNode.extend({
  node_type: z.literal('textbook'),
  edition: z.string().optional(),
  publisher: z.string().optional(),
  publish_year: z.number().int().optional(),
});

export const ChapterNode = BaseNode.extend({
  node_type: z.literal('chapter'),
  chapter_no: z.string().optional(),
  page_range: z.string().optional(),
});

export const SectionNode = BaseNode.extend({
  node_type: z.literal('section'),
  section_no: z.string().optional(),
});

export const KnowledgePointNode = BaseNode.extend({
  node_type: z.literal('knowledge_point'),
  textbook: z.string().optional(),
  edition: z.string().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
  page_no: z.number().int().optional(),
  knowledge_type: KnowledgeType,
  difficulty: Difficulty.optional(),
  importance: Importance.optional(),
});

export const TermNode = BaseNode.extend({
  node_type: z.literal('term'),
  standard_term: z.string(),
  aliases: z.array(z.string()).default([]),
  english: z.string().optional(),
  category: z.string().optional(),
});

export const OperationStepNode = BaseNode.extend({
  node_type: z.literal('operation_step'),
  step_order: z.number().int(),
  phase: z.string(),
});

export const CompetencyNode = BaseNode.extend({
  node_type: z.literal('competency'),
  competency_level: CompetencyLevel,
  domain: z.string(),
});

export const ImageNode = BaseNode.extend({
  node_type: z.literal('image'),
  oss_key: z.string().optional(),
  caption: z.string().optional(),
  visual_summary: z.string().optional(),
  page_no: z.number().int().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const TableNode = BaseNode.extend({
  node_type: z.literal('table'),
  table_title: z.string().optional(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  summary: z.string().optional(),
});

export const QuestionNode = BaseNode.extend({
  node_type: z.literal('question'),
  question_type: z.string(),
  difficulty: Difficulty.optional(),
  exam_scene: z.string().optional(),
  cognitive_level: z.string().optional(),
});

export const CaseNode = BaseNode.extend({
  node_type: z.literal('case'),
  case_type: z.string(),
  scene: z.string().optional(),
  symptoms: z.array(z.string()).default([]),
  teaching_objectives: z.array(z.string()).default([]),
});

export const Node = z.discriminatedUnion('node_type', [
  TextbookNode, ChapterNode, SectionNode, KnowledgePointNode, TermNode,
  OperationStepNode, CompetencyNode, ImageNode, TableNode, QuestionNode, CaseNode,
]);
export type Node = z.infer<typeof Node>;
```

**Step 4：跑测试通过**

Run: `npm -w @mkg/shared test`
Expected: PASS。

**Step 5：Commit**

```powershell
git add shared/src/schemas/node.ts shared/src/__tests__/node.test.ts
git commit -m "feat(agent-f): add node schemas with discriminated union"
```

---

## Task 4：关系 / 图谱 / AI 任务 Schema

**Files:**
- Create: `shared/src/schemas/relation.ts`
- Create: `shared/src/schemas/graph.ts`
- Create: `shared/src/schemas/ai.ts`
- Create: `shared/src/__tests__/relation.test.ts`

**Step 1：写测试（节选）**

```ts
import { describe, it, expect } from 'vitest';
import { Relation } from '../schemas/relation';
import { Graph } from '../schemas/graph';
import { AIGenerateRequest, AIGenerateOutput } from '../schemas/ai';

describe('relation/graph/ai schemas', () => {
  it('Relation 校验通过', () => {
    expect(Relation.safeParse({
      source_id: 'KP_1', target_id: 'KP_2', relation_type: 'PREREQUISITE_OF', confidence: 0.9,
    }).success).toBe(true);
  });
  it('Graph graph_type 限定', () => {
    expect(Graph.safeParse({
      graph_id: 'g1', graph_name: '基础护理', graph_type: 'course',
    }).success).toBe(true);
  });
  it('AIGenerateOutput 必含 nodes/relations', () => {
    expect(AIGenerateOutput.safeParse({ graph_name: 'x', nodes: [], relations: [] }).success).toBe(true);
  });
});
```

**Step 2：实现 `shared/src/schemas/relation.ts`**

```ts
import { z } from 'zod';
import { RelationType, NodeStatus, NodeSource } from '../enums';

export const Relation = z.object({
  relation_id: z.string().optional(),
  source_id: z.string(),
  target_id: z.string(),
  relation_type: RelationType,
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
  status: NodeStatus.default('candidate'),
  source: NodeSource.default('manual'),
  ai_job_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
});
export type Relation = z.infer<typeof Relation>;
```

**Step 3：实现 `shared/src/schemas/graph.ts`**

```ts
import { z } from 'zod';
import { GraphType } from '../enums';

export const Graph = z.object({
  graph_id: z.string().min(1),
  graph_name: z.string().min(1),
  graph_type: GraphType.default('course'),
  subject: z.string().optional(),
  course_name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  node_count: z.number().int().default(0),
  relation_count: z.number().int().default(0),
  created_by: z.string().optional(),
  created_at: z.string().datetime().optional(),
});
export type Graph = z.infer<typeof Graph>;

export const GraphCreateInput = Graph.pick({
  graph_name: true, graph_type: true, subject: true, course_name: true, description: true,
});
export type GraphCreateInput = z.infer<typeof GraphCreateInput>;
```

**Step 4：实现 `shared/src/schemas/ai.ts`**

```ts
import { z } from 'zod';
import { Node } from './node';
import { Relation } from './relation';

export const AIGenerateRequest = z.object({
  template_id: z.string().uuid(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  graph_id: z.string().optional(),
});
export type AIGenerateRequest = z.infer<typeof AIGenerateRequest>;

export const AIJobStatus = z.enum(['pending', 'running', 'success', 'failed', 'partial']);
export type AIJobStatus = z.infer<typeof AIJobStatus>;

export const AIGenerateOutput = z.object({
  graph_name: z.string(),
  nodes: z.array(Node),
  relations: z.array(Relation),
});
export type AIGenerateOutput = z.infer<typeof AIGenerateOutput>;

// LLM 直出形态用 AIGenerateOutput；GET /jobs/:id 复用 nodes/relations，graph_name 已经在 graph_id 上下文里冗余，故 partial
export const AIJobOutput = AIGenerateOutput.partial({ graph_name: true });
export type AIJobOutput = z.infer<typeof AIJobOutput>;

export const AIJob = z.object({
  job_id: z.string(),
  status: AIJobStatus,
  graph_id: z.string().optional(),
  output: AIJobOutput.optional(),
  error: z.string().optional(),
  created_at: z.string().datetime().optional(),
});
export type AIJob = z.infer<typeof AIJob>;

export const ApproveBody = z.object({
  node_ids: z.array(z.string()).default([]),
  relation_ids: z.array(z.string()).default([]),
});
```

**Step 5：跑测试通过 + Commit**

Run: `npm -w @mkg/shared test`
Expected: PASS。

```powershell
git add shared/src/schemas/ shared/src/__tests__/relation.test.ts
git commit -m "feat(agent-f): add relation/graph/ai schemas"
```

---

## Task 5：用户 / 模板 / Auth Schema

**Files:**
- Create: `shared/src/schemas/user.ts`
- Create: `shared/src/schemas/auth.ts`
- Create: `shared/src/schemas/template.ts`

**Step 1：写 `shared/src/schemas/user.ts`**

```ts
import { z } from 'zod';
import { UserRole } from '../enums';

export const User = z.object({
  id: z.string().uuid(),
  username: z.string().min(2).max(50),
  email: z.string().email(),
  role: UserRole,
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
});
export type User = z.infer<typeof User>;

export const UserCreateInput = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: UserRole.default('operator'),
});
```

**Step 2：写 `shared/src/schemas/auth.ts`**

```ts
import { z } from 'zod';
import { User } from './user';

export const LoginInput = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const LoginResponse = z.object({
  token: z.string(),
  user: User,
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const JwtPayload = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  role: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type JwtPayload = z.infer<typeof JwtPayload>;
```

**Step 3：写 `shared/src/schemas/template.ts`**

```ts
import { z } from 'zod';

export const TemplateVariable = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'number', 'boolean', 'textarea']),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().default(false),
});
export type TemplateVariable = z.infer<typeof TemplateVariable>;

export const PromptTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  variables: z.array(TemplateVariable),
  system_prompt: z.string(),
  user_prompt_template: z.string(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().default(true),
  created_by: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type PromptTemplate = z.infer<typeof PromptTemplate>;

export const PromptTemplateCreateInput = PromptTemplate.pick({
  name: true, description: true, variables: true,
  system_prompt: true, user_prompt_template: true, output_schema: true,
});
```

**Step 4：Commit**

```powershell
git add shared/src/schemas/user.ts shared/src/schemas/auth.ts shared/src/schemas/template.ts
git commit -m "feat(agent-f): add user/auth/template schemas"
```

---

## Task 6：统一导出 + barrel

**Files:**
- Modify: `shared/src/index.ts`

**Step 1：写 `shared/src/index.ts`**

```ts
export * from './enums';
export * from './schemas/node';
export * from './schemas/relation';
export * from './schemas/graph';
export * from './schemas/ai';
export * from './schemas/user';
export * from './schemas/auth';
export * from './schemas/template';
```

**Step 2：验证编译 + Commit**

Run: `npm -w @mkg/shared run build`
Expected: 无错误。

```powershell
git add shared/src/index.ts
git commit -m "feat(agent-f): barrel export all schemas"
```

---

## Task 7：OpenAPI 契约生成器

**Files:**
- Create: `shared/src/openapi/registry.ts`
- Create: `shared/src/openapi/build.ts`

**Step 1：写 `shared/src/openapi/registry.ts`**

```ts
import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  Node, Relation, Graph, GraphCreateInput,
  AIGenerateRequest, AIJob, ApproveBody,
  User, UserCreateInput, LoginInput, LoginResponse,
  PromptTemplate, PromptTemplateCreateInput,
} from '../index';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.register('Node', Node);
registry.register('Relation', Relation);
registry.register('Graph', Graph);
registry.register('User', User);
registry.register('PromptTemplate', PromptTemplate);
registry.register('AIJob', AIJob);

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
});

// Auth
registry.registerPath({
  method: 'post', path: '/api/auth/login', tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: LoginInput } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: LoginResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/auth/logout', tags: ['auth'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});
registry.registerPath({
  method: 'get', path: '/api/auth/me', tags: ['auth'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: User } } } },
});

// ===== Users =====
registry.registerPath({
  method: 'get',  path: '/api/users', tags: ['users'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(User) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/users', tags: ['users'], security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: UserCreateInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: User } } } },
});
registry.registerPath({
  method: 'put',  path: '/api/users/{id}/role', tags: ['users'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ role: UserRole }) } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: User } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/users/{id}', tags: ['users'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

// ===== Templates =====
registry.registerPath({
  method: 'get',    path: '/api/templates',       tags: ['templates'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(PromptTemplate) } } } },
});
registry.registerPath({
  method: 'post',   path: '/api/templates',       tags: ['templates'], security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: PromptTemplateCreateInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: PromptTemplate } } } },
});
registry.registerPath({
  method: 'get',    path: '/api/templates/{id}',  tags: ['templates'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: PromptTemplate } } } },
});
registry.registerPath({
  method: 'put',    path: '/api/templates/{id}',  tags: ['templates'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PromptTemplateCreateInput.partial() } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: PromptTemplate } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/templates/{id}',  tags: ['templates'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

// ===== Graphs =====
registry.registerPath({
  method: 'get', path: '/api/graphs', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(Graph) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/graphs', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: GraphCreateInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: Graph } } } },
});
registry.registerPath({
  method: 'get', path: '/api/graphs/{id}', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({
    graph: Graph, nodes: z.array(Node), relations: z.array(Relation),
  }) } } } },
});
registry.registerPath({
  method: 'put',    path: '/api/graphs/{id}', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: GraphCreateInput.partial() } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Graph } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/graphs/{id}', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});
registry.registerPath({
  method: 'get',    path: '/api/graphs/{id}/export', tags: ['graphs'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({
    graph: Graph, nodes: z.array(Node), relations: z.array(Relation),
  }) } } } },
});

// ===== Nodes =====
registry.registerPath({
  method: 'get',    path: '/api/graphs/{id}/nodes', tags: ['nodes'], security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      node_type: NodeType.optional(), status: NodeStatus.optional(),
      keyword: z.string().optional(), skip: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({
    items: z.array(Node), total: z.number().int(), skip: z.number().int(), limit: z.number().int(),
  }) } } } },
});
registry.registerPath({
  method: 'post',   path: '/api/graphs/{id}/nodes', tags: ['nodes'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: NodeCreateInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: Node } } } },
});
registry.registerPath({
  method: 'put',    path: '/api/nodes/{nodeId}', tags: ['nodes'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ nodeId: z.string() }), body: { content: { 'application/json': { schema: NodeUpdateInput } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Node } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/nodes/{nodeId}', tags: ['nodes'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ nodeId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

// ===== Relations =====
registry.registerPath({
  method: 'get',    path: '/api/graphs/{id}/relations', tags: ['relations'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(Relation) } } } },
});
registry.registerPath({
  method: 'post',   path: '/api/graphs/{id}/relations', tags: ['relations'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: RelationCreateInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: Relation } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/relations/{relationId}', tags: ['relations'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ relationId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

// ===== AI =====
registry.registerPath({
  method: 'post', path: '/api/ai/generate', tags: ['ai'], security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: AIGenerateRequest } } } },
  responses: { 202: { description: 'Accepted', content: { 'application/json': { schema: z.object({ job_id: z.string() }) } } } },
});
registry.registerPath({
  method: 'get',  path: '/api/ai/jobs/{jobId}', tags: ['ai'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: AIJob } } } },
});
registry.registerPath({
  method: 'post', path: '/api/ai/jobs/{jobId}/approve-all', tags: ['ai'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean(), nodes: z.number().int(), relations: z.number().int() }) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/ai/jobs/{jobId}/approve', tags: ['ai'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }), body: { content: { 'application/json': { schema: ApproveBody } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean(), nodes: z.number().int(), relations: z.number().int() }) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/ai/jobs/{jobId}/reject-all', tags: ['ai'], security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean(), nodes: z.number().int(), relations: z.number().int() }) } } } },
});

// ===== System =====
registry.registerPath({
  method: 'get',  path: '/api/system/ai-logs', tags: ['system'], security: [{ [bearer.name]: [] }],
  request: { query: z.object({ graph_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ items: z.array(AIGenerationLog), total: z.number().int() }) } } } },
});
registry.registerPath({
  method: 'get',  path: '/api/system/llm', tags: ['system'], security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: LLMConfig } } } },
});
registry.registerPath({
  method: 'get',  path: '/api/health', tags: ['system'],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean(), version: z.string() }) } } } },
});
```

> **路径覆盖完工标志：** 上面已注册 27 条路径（auth×3 / users×4 / templates×5 / graphs×5 / nodes×3 / relations×4 / ai×5 / system×3），与设计文档 §5 完全对齐。新增端点须先在此处注册再实现。

**Step 2：写 `shared/src/openapi/build.ts`**

```ts
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import yaml from 'yaml';
import { registry } from './registry';

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: '医学知识图谱 API',
    version: '0.1.0',
    description: '由 @mkg/shared 自动生成。请勿手工修改。',
  },
  servers: [{ url: 'http://localhost:4000' }],
});
process.stdout.write(yaml.stringify(doc));
```

**Step 3：跑生成器**

Run: `npm -w @mkg/shared run openapi:gen`
Expected: 生成 `backend/openapi.yaml`，能在 Swagger UI 中打开。

**Step 4：Commit**

```powershell
git add shared/src/openapi backend/openapi.yaml
git commit -m "feat(agent-f): generate openapi.yaml from zod schemas"
```

---

## Task 8：Cypher / 节点 ID 工具函数

**Files:**
- Create: `shared/src/utils/id.ts`
- Create: `shared/src/utils/__tests__/id.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { generateNodeId, isValidNodeId } from '../id';

describe('id utils', () => {
  it('生成符合 KP_xxx 格式', () => {
    expect(generateNodeId('knowledge_point').startsWith('KP_')).toBe(true);
  });
  it('校验通过', () => {
    expect(isValidNodeId('KP_001')).toBe(true);
    expect(isValidNodeId('invalid id')).toBe(false);
  });
});
```

**Step 2：实现 `shared/src/utils/id.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { NodeType } from '../enums';

const PREFIX: Record<NodeType, string> = {
  textbook: 'TB', chapter: 'CH', section: 'SE', knowledge_point: 'KP',
  term: 'TM', operation_step: 'OP', competency: 'CP',
  image: 'IM', table: 'TA', question: 'QU', case: 'CA',
};

export function generateNodeId(type: NodeType): string {
  const tail = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `${PREFIX[type]}_${tail}`;
}

export function generateGraphId(): string {
  return `graph_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function isValidNodeId(id: string): boolean {
  return /^[A-Z]{2,3}_[A-Z0-9]{3,}$/.test(id);
}
```

**Step 3：测试通过 + Commit**

```powershell
git add shared/src/utils
git commit -m "feat(agent-f): add node id utils"
```

---

## Task 9：发布到 workspace + 自检

**Step 1：构建并验证消费**

Run:
```powershell
npm -w @mkg/shared run build
node -e "import('@mkg/shared').then(m => console.log(Object.keys(m).length))"
```
Expected: 输出导出符号数量（应 > 20）。

**Step 2：在仓库根添加 npm script**

修改根 `package.json`，新增：

```json
"scripts": {
  "shared:build": "npm -w @mkg/shared run build",
  "openapi:gen": "npm -w @mkg/shared run openapi:gen"
}
```

**Step 3：Commit + 发 PR**

```powershell
git add package.json
git commit -m "chore(agent-f): add shared/openapi scripts to root"
```

PR 标题：`[Agent-F] Shared schemas + OpenAPI contracts`。

---

## Agent-F 完工标志（DoD）

- [ ] `shared/dist/` 构建产物完整
- [ ] `import { Node, Relation, Graph, ... } from '@mkg/shared'` 在 backend / frontend 都可用
- [ ] `backend/openapi.yaml` 已生成且能在 Swagger UI 打开
- [ ] 单测覆盖所有 Schema 边界用例
- [ ] CI typecheck + test 全绿
