# Agent-C — AI 生成引擎实施计划（同步模式，无队列）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 实现 `/api/ai/generate`、`/api/ai/jobs/:jobId`、`/api/ai/jobs/:jobId/approve` 三组接口；将 Prompt 模板（来自 `prompt_templates` 表）+ 用户变量拼装成完整 Prompt，调用 OpenAI 兼容 LLM，校验输出 JSON Schema，将"待审核"节点/关系写入 Neo4j（status=`candidate`），并支持一键全部确认或逐条审核。

**架构（Architecture）:** **MVP 阶段不引入 Redis/BullMQ**。`generate` 接口在收到请求后立即同步调用 LLM，将 `ai_generation_logs` 记录置 `running`，完成后置 `success`/`failed`；前端通过 `GET /api/ai/jobs/:jobId` 拉取最新状态。LLM 调用用 OpenAI 兼容协议（支持 GPT-4o / Claude / DeepSeek / 智谱），通过 `LLM_BASE_URL` 切换。所有 LLM 输出经 Zod 严校验，失败重试 1 次。

**技术栈:** OpenAI SDK 兼容（直接使用 `fetch`，避免锁定 SDK 版本）· zod · 设计文档 §4.2 系统提示词 · Agent-A 的 Prisma · Agent-B 的 NodeService/RelationService。

---

## 工作分支

`feature/agent-c-ai-engine`

## 输出目录（仅本 Agent 可写）

- `backend/src/services/llm/`
- `backend/src/services/template/`
- `backend/src/modules/ai/`

## 关键依赖

- ✅ Agent-A 的 `prompt_templates`、`ai_generation_logs` 表已可用
- ✅ Agent-A 的 `auth` 中间件、`requireRole`、`errorHandler` 可用
- ✅ Agent-B 的 `NodeService.createBatch / bulkUpdateStatusByJob(graphId, jobId, status) / bulkUpdateStatusByIds(graphId, ids, status) / bulkDeleteByJob(graphId, jobId) / listByAiJob(graphId, jobId)` 可用（见 Agent-B Task 15a）
- ✅ Agent-B 的 `RelationService.createBatch / bulkUpdateStatusByJob(graphId, jobId, status) / bulkUpdateStatusByIds(graphId, relationIds, status) / bulkDeleteByJob(graphId, jobId) / listByAiJob(graphId, jobId)` 可用
- ✅ Agent-F 的 `AIGenerateOutput`（含 nodes/relations）与 `AIJob` schema 已发布（Task 4）；本 Agent 只用 `AIGenerateOutput` 这一名字

---

## Task 1：Prompt 拼装服务

**Files:**
- Create: `backend/src/services/template/render.ts`
- Create: `backend/src/services/template/__tests__/render.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../render';

describe('renderPrompt', () => {
  const tpl = '请为《{{course_name}}》中的「{{chapter_name}}」构建图谱。详细程度：{{depth}}';
  it('正常替换变量', () => {
    const out = renderPrompt(tpl, {
      course_name: '基础护理学',
      chapter_name: '静脉输液与输血',
      depth: '标准',
    });
    expect(out).toBe('请为《基础护理学》中的「静脉输液与输血」构建图谱。详细程度：标准');
  });
  it('缺失变量抛错', () => {
    expect(() => renderPrompt(tpl, { course_name: 'x' } as any)).toThrow(/chapter_name/);
  });
  it('防止意外的变量注入（{{}} 内仅允许 [a-zA-Z0-9_]）', () => {
    expect(renderPrompt('{{x}} {{a-b}}', { x: '1' } as any)).toBe('1 {{a-b}}');
  });
});
```

**Step 2：实现 `render.ts`**

```ts
const VAR_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function renderPrompt(
  template: string,
  variables: Record<string, string>,
): string {
  const missing: string[] = [];
  const out = template.replace(VAR_PATTERN, (_m, key: string) => {
    if (!(key in variables)) {
      missing.push(key);
      return '';
    }
    return String(variables[key]);
  });
  if (missing.length) {
    throw new Error(`渲染 Prompt 缺失变量: ${missing.join(', ')}`);
  }
  return out;
}
```

**Step 3：测试通过 + Commit**

```powershell
git add backend/src/services/template
git commit -m "feat(agent-c): add prompt render util"
```

---

## Task 2：模板变量校验

**Files:**
- Create: `backend/src/services/template/validate.ts`
- Create: `backend/src/services/template/__tests__/validate.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { validateVariables } from '../validate';

const def = [
  { key: 'course_name', label: '课程', type: 'text', required: true },
  { key: 'depth', label: '详细程度', type: 'select', options: ['基础', '标准', '详细'], required: true },
];

describe('validateVariables', () => {
  it('text 缺失必填抛错', () => {
    expect(() => validateVariables(def, { depth: '标准' })).toThrow(/course_name/);
  });
  it('select 取值不在列表内抛错', () => {
    expect(() => validateVariables(def, { course_name: 'x', depth: '魔鬼' })).toThrow(/depth/);
  });
  it('合法时返回原值', () => {
    expect(validateVariables(def, { course_name: 'x', depth: '标准' }))
      .toEqual({ course_name: 'x', depth: '标准' });
  });
});
```

**Step 2：实现（直接使用 Agent-F 的 `TemplateVariable` schema，避免类型分裂）**

```ts
import type { TemplateVariable } from '@mkg/shared';

export type VariableInput = string | number | boolean;
export type RenderedVariables = Record<string, string>;

export function validateVariables(
  defs: TemplateVariable[],
  input: Record<string, VariableInput | undefined>,
): RenderedVariables {
  const out: RenderedVariables = {};
  for (const def of defs) {
    const raw = input[def.key] ?? def.default;
    if (def.required && (raw === undefined || raw === '')) {
      throw new Error(`必填变量缺失: ${def.key}`);
    }
    if (raw === undefined) continue;

    // 类型校验
    if (def.type === 'select' && def.options && !def.options.includes(String(raw))) {
      throw new Error(`变量 ${def.key} 取值非法: ${raw}`);
    }
    if (def.type === 'number' && typeof raw !== 'number' && Number.isNaN(Number(raw))) {
      throw new Error(`变量 ${def.key} 必须为数字: ${raw}`);
    }
    if (def.type === 'boolean' && typeof raw !== 'boolean' && raw !== 'true' && raw !== 'false') {
      throw new Error(`变量 ${def.key} 必须为布尔: ${raw}`);
    }

    // 统一转字符串供 prompt 模板插值
    out[def.key] = String(raw);
  }
  return out;
}
```

> `TemplateVariable.type` 取值：`'text' | 'select' | 'number' | 'boolean' | 'textarea'`（来自 `@mkg/shared`，单一真理源）。Agent-F 已支持 `textarea`，详见 Agent-F Task 5 schema。

**Step 3：Commit**

```powershell
git add backend/src/services/template/validate.ts backend/src/services/template/__tests__/validate.test.ts
git commit -m "feat(agent-c): add template variable validator"
```

---

## Task 3：LLM Service（OpenAI 兼容）

**Files:**
- Create: `backend/src/services/llm/llm.service.ts`
- Create: `backend/src/services/llm/__tests__/llm.service.test.ts`

**Step 1：写测试（用 mock fetch）**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  process.env.LLM_API_KEY = 'sk-test';
  process.env.LLM_BASE_URL = 'https://api.example.com/v1';
  process.env.LLM_MODEL = 'gpt-4o-mini';
  process.env.JWT_SECRET = 'x';
  process.env.POSTGRES_URL = 'postgresql://u:p@h/db';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('llm.service', () => {
  it('chatCompletion 拼装 system+user 并返回 content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { chatCompletion } = await import('../llm.service');
    const out = await chatCompletion({ system: 'sys', user: 'u' });
    expect(out).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'u' });
  });
  it('LLM 返回 4xx 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no key' }));
    const { chatCompletion } = await import('../llm.service');
    await expect(chatCompletion({ system: 's', user: 'u' })).rejects.toThrow(/401/);
  });
});
```

**Step 2：实现**

```ts
import { env } from '../../config/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  responseFormat?: 'json_object' | 'text';
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  const body: Record<string, unknown> = {
    model: env.LLM_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败 ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? '';
}
```

**Step 3：测试通过 + Commit**

```powershell
git add backend/src/services/llm
git commit -m "feat(agent-c): add openai-compatible llm client"
```

---

## Task 4：LLM 输出校验与解析

**Files:**
- Create: `backend/src/services/llm/parse.ts`
- Create: `backend/src/services/llm/__tests__/parse.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseLLMGraph } from '../parse';

describe('parseLLMGraph', () => {
  it('正常 JSON 通过', () => {
    const json = JSON.stringify({
      graph_name: '静脉输液',
      nodes: [{ node_id: 'KP_1', node_type: 'knowledge_point', name: 'x', knowledge_type: '概念类', confidence: 0.9 }],
      relations: [],
    });
    const out = parseLLMGraph(json);
    expect(out.nodes.length).toBe(1);
  });
  it('包裹 markdown ```json 也能解析', () => {
    const wrapped = '```json\n{"graph_name":"x","nodes":[],"relations":[]}\n```';
    expect(parseLLMGraph(wrapped).graph_name).toBe('x');
  });
  it('结构非法抛错', () => {
    expect(() => parseLLMGraph('{"foo":1}')).toThrow();
  });
});
```

**Step 2：实现**

```ts
import { AIGenerateOutput } from '@mkg/shared';

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

export function parseLLMGraph(raw: string): import('@mkg/shared').AIGenerateOutput {
  const stripped = FENCE.exec(raw)?.[1] ?? raw;
  let json: unknown;
  try {
    json = JSON.parse(stripped.trim());
  } catch (e) {
    throw new Error(`LLM 输出非合法 JSON: ${(e as Error).message}`);
  }
  return AIGenerateOutput.parse(json);
}
```

> 注：`AIGenerateOutput` 由 Agent-F Task 4 定义，schema 形如：
>
> ```ts
> export const AIGenerateOutput = z.object({
>   graph_name: z.string(),
>   nodes: z.array(LLMNode),
>   relations: z.array(LLMRelation),
> });
> ```

**Step 3：Commit**

```powershell
git add backend/src/services/llm/parse.ts backend/src/services/llm/__tests__/parse.test.ts
git commit -m "feat(agent-c): add llm output parser+zod validator"
```

---

## Task 5：`POST /api/ai/generate` 同步生成

**Files:**
- Create: `backend/src/modules/ai/ai.service.ts`
- Create: `backend/src/modules/ai/ai.routes.ts`
- Create: `backend/src/modules/ai/__tests__/ai.service.test.ts`
- Modify: `backend/src/app.ts`

**Step 1：先在 `app.ts` 挂路由（占位）**

```ts
import { aiRouter } from './modules/ai/ai.routes';
app.use('/api/ai', aiRouter);
```

**Step 2：写 service 测试（mock LLM、mock Neo4j 写入）**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../services/llm/llm.service', () => ({
  chatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
    graph_name: '静脉输液',
    nodes: [{ node_id: 'KP_1', node_type: 'knowledge_point', name: '静脉输液概念', knowledge_type: '概念类', confidence: 0.9 }],
    relations: [],
  })),
}));
vi.mock('../../graphs/graph.service', () => ({
  GraphService: { getById: vi.fn().mockResolvedValue({ graph_id: 'graph_x' }) },
}));
vi.mock('../../nodes/node.service', () => ({
  NodeService: { createBatch: vi.fn().mockResolvedValue([{ node_id: 'KP_1' }]) },
}));
vi.mock('../../relations/relation.service', () => ({
  RelationService: { createBatch: vi.fn().mockResolvedValue([]) },
}));

describe('aiService.generate', () => {
  it('成功路径写入候选节点并返回 jobId', async () => {
    const { aiService } = await import('../ai.service');
    const job = await aiService.generate({
      template_id: 'tpl_1',
      variables: { course_name: '基础护理学', chapter_name: '静脉输液', depth: '标准' },
      graph_id: 'graph_x',
      user_id: 'user_x',
      template: { system_prompt: 'sys', user_prompt_template: '{{course_name}} {{chapter_name}} {{depth}}', variables: [] as any },
    });
    expect(job.status).toBe('success');
    expect(job.nodes_created).toBe(1);
  });
});
```

**Step 3：实现 `ai.service.ts`**

```ts
import { prisma } from '../../lib/prisma';
import { chatCompletion } from '../../services/llm/llm.service';
import { parseLLMGraph } from '../../services/llm/parse';
import { renderPrompt } from '../../services/template/render';
import { validateVariables } from '../../services/template/validate';
import { NodeService } from '../nodes/node.service';
import { RelationService } from '../relations/relation.service';
import { GraphService } from '../graphs/graph.service';

export const aiService = {
  async generate(input: {
    template_id: string;
    variables: Record<string, string>;
    graph_id: string;
    user_id: string;
    template: { system_prompt: string; user_prompt_template: string; variables: any[] };
  }) {
    const log = await prisma.aiGenerationLog.create({
      data: {
        graph_id: input.graph_id,
        template_id: input.template_id,
        user_id: input.user_id,
        status: 'running',
        prompt_used: '',
        llm_response: '',
      },
    });
    try {
      const vars = validateVariables(input.template.variables, input.variables);
      const userPrompt = renderPrompt(input.template.user_prompt_template, vars);
      const raw = await chatCompletion({
        system: input.template.system_prompt,
        user: userPrompt,
        responseFormat: 'json_object',
      });
      const parsed = parseLLMGraph(raw);

      // 全部以 candidate 状态写入，并标记 ai_job_id 便于审核 / 撤销
      const nodes = await NodeService.createBatch(
        input.graph_id,
        parsed.nodes,
        { status: 'candidate', source: 'ai_generated', ai_job_id: log.id },
      );
      const relations = await RelationService.createBatch(
        input.graph_id,
        parsed.relations,
        { status: 'candidate', source: 'ai_generated', ai_job_id: log.id },
      );

      const updated = await prisma.aiGenerationLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          prompt_used: userPrompt,
          llm_response: raw,
          nodes_created: nodes.length,
          relations_created: relations.length,
        },
      });
      return { job_id: updated.id, status: updated.status, nodes_created: nodes.length, relations_created: relations.length };
    } catch (e) {
      await prisma.aiGenerationLog.update({
        where: { id: log.id },
        data: { status: 'failed', error_msg: (e as Error).message },
      });
      throw e;
    }
  },
};
```

**Step 4：实现 `ai.routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import { AIGenerateRequest } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { aiService } from './ai.service';

export const aiRouter = Router();
aiRouter.use(requireAuth);

// 直接复用 Agent-F schema，避免类型分裂；variables 接受 string|number|boolean
const GenerateBody = AIGenerateRequest;

aiRouter.post('/generate', requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const body = GenerateBody.parse(req.body);
    const tpl = await prisma.promptTemplate.findUniqueOrThrow({ where: { id: body.template_id } });
    const job = await aiService.generate({
      ...body,
      user_id: req.user!.id,
      template: tpl as any,
    });
    res.json(job);
  } catch (e) { next(e); }
});

aiRouter.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const log = await prisma.aiGenerationLog.findUniqueOrThrow({ where: { id: req.params.jobId } });
    // 严格对齐 Agent-F AIJob schema：{ job_id, status, graph_id?, output?: AIJobOutput, error?, created_at? }
    let output: AIJobOutput | undefined;
    if (log.status === 'success' && log.graph_id) {
      const nodes = await NodeService.listByAiJob(log.graph_id, log.id);
      const relations = await RelationService.listByAiJob(log.graph_id, log.id);
      output = { nodes, relations };
    }
    const payload: AIJob = {
      job_id: log.id,
      status: log.status as AIJob['status'],
      graph_id: log.graph_id ?? undefined,
      output,
      error: log.error_msg ?? undefined,
      created_at: log.created_at.toISOString(),
    };
    res.json(payload);
  } catch (e) { next(e); }
});
```

> 依赖：`NodeService.listByAiJob(graphId, jobId)` / `RelationService.listByAiJob(graphId, jobId)` 由 Agent-B Task 15a 提供；只读，不改 status。文件顶部需加：
>
> ```ts
> import { AIJob, AIJobOutput } from '@mkg/shared';
> ```

**Step 5：测试通过 + Commit**

```powershell
git add backend/src/modules/ai backend/src/app.ts
git commit -m "feat(agent-c): add /api/ai/generate sync endpoint"
```

---

## Task 6：审核 API（一键 / 逐条 / 全部丢弃）

**Files:**
- Modify: `backend/src/modules/ai/ai.routes.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Create: `backend/src/modules/ai/__tests__/approve.test.ts`

**契约（与 Agent-F `ApproveBody`、Agent-B 三参数 bulk* 严格对齐）：**

| 方法 | 路径 | 角色 | Body | 响应 |
|---|---|---|---|---|
| POST | `/api/ai/jobs/:jobId/approve-all` | admin/expert | —                              | `{ ok: true, nodes: number, relations: number }` |
| POST | `/api/ai/jobs/:jobId/approve`     | admin/expert | `{ node_ids: string[], relation_ids: string[] }` | 同上（数字为本次更新条数） |
| POST | `/api/ai/jobs/:jobId/reject-all`  | admin/expert | —                              | `{ ok: true, nodes: number, relations: number }`（删除条数）|

错误：404 job 不存在；409 `JOB_NOT_SUCCEEDED`（status ≠ success 时禁止审核）。

**Step 1：写测试（`approve.test.ts`，全部 mock NodeService/RelationService）**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';
import { NodeService } from '../../../services/neo4j/node.service.batch';
import { RelationService } from '../../../services/neo4j/relation.service.batch';

const app = createApp();
const adminToken = signToken({ id: 'u_a', role: 'admin' });

beforeEach(async () => {
  await prisma.aiGenerationLog.deleteMany();
  await prisma.aiGenerationLog.create({
    data: {
      id: 'job_ok',
      graph_id: 'graph_x',
      template_id: 't_1',
      user_id: 'u_a',
      status: 'success',
      nodes_created: 3, relations_created: 2,
      prompt_used: '', llm_response: '',
    },
  });
  await prisma.aiGenerationLog.create({
    data: {
      id: 'job_fail',
      graph_id: 'graph_x',
      template_id: 't_1',
      user_id: 'u_a',
      status: 'failed',
      nodes_created: 0, relations_created: 0,
      prompt_used: '', llm_response: '', error_msg: 'x',
    },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('approve-all', () => {
  it('调用 NodeService/RelationService 并返回数量', async () => {
    vi.spyOn(NodeService,     'bulkUpdateStatusByJob').mockResolvedValue(3);
    vi.spyOn(RelationService, 'bulkUpdateStatusByJob').mockResolvedValue(2);

    const r = await request(app)
      .post('/api/ai/jobs/job_ok/approve-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 3, relations: 2 });
    expect(NodeService.bulkUpdateStatusByJob).toHaveBeenCalledWith('graph_x', 'job_ok', 'approved');
    expect(RelationService.bulkUpdateStatusByJob).toHaveBeenCalledWith('graph_x', 'job_ok', 'approved');
  });

  it('job 状态非 success → 409', async () => {
    const r = await request(app)
      .post('/api/ai/jobs/job_fail/approve-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('JOB_NOT_SUCCEEDED');
  });

  it('job 不存在 → 404', async () => {
    const r = await request(app)
      .post('/api/ai/jobs/job_404/approve-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });
});

describe('approve (selected)', () => {
  it('node_ids/relation_ids 透传到 service', async () => {
    const nSpy = vi.spyOn(NodeService,     'bulkUpdateStatusByIds').mockResolvedValue(2);
    const rSpy = vi.spyOn(RelationService, 'bulkUpdateStatusByIds').mockResolvedValue(1);
    const r = await request(app)
      .post('/api/ai/jobs/job_ok/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ node_ids: ['KP_1', 'KP_2'], relation_ids: ['10'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 2, relations: 1 });
    expect(nSpy).toHaveBeenCalledWith('graph_x', ['KP_1', 'KP_2'], 'approved');
    expect(rSpy).toHaveBeenCalledWith('graph_x', ['10'], 'approved');
  });

  it('空 ids 数组也 200', async () => {
    vi.spyOn(NodeService,     'bulkUpdateStatusByIds').mockResolvedValue(0);
    vi.spyOn(RelationService, 'bulkUpdateStatusByIds').mockResolvedValue(0);
    const r = await request(app)
      .post('/api/ai/jobs/job_ok/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ node_ids: [], relation_ids: [] });
    expect(r.status).toBe(200);
  });
});

describe('reject-all', () => {
  it('删除候选节点和关系', async () => {
    vi.spyOn(NodeService,     'bulkDeleteByJob').mockResolvedValue(3);
    vi.spyOn(RelationService, 'bulkDeleteByJob').mockResolvedValue(2);
    const r = await request(app)
      .post('/api/ai/jobs/job_ok/reject-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 3, relations: 2 });
  });
});
```

**Step 2：实现 service（带状态校验 + 三参数）**

```ts
// ai.service.ts
import { ApproveBody as SharedApproveBody } from '@mkg/shared';

class HttpError extends Error {
  constructor(public status: number, public code: string, msg: string) { super(msg); }
}

async function loadSucceededLog(job_id: string) {
  const log = await prisma.aiGenerationLog.findUnique({ where: { id: job_id } });
  if (!log) throw new HttpError(404, 'NOT_FOUND', 'job not found');
  if (log.status !== 'success') throw new HttpError(409, 'JOB_NOT_SUCCEEDED', `job status=${log.status}`);
  if (!log.graph_id) throw new HttpError(409, 'JOB_NOT_SUCCEEDED', 'job has no graph');
  return log;
}

export const aiService = {
  // ...generate 略
  async approveAll(job_id: string) {
    const log = await loadSucceededLog(job_id);
    const nodes     = await NodeService.bulkUpdateStatusByJob(log.graph_id!, job_id, 'approved');
    const relations = await RelationService.bulkUpdateStatusByJob(log.graph_id!, job_id, 'approved');
    return { ok: true, nodes, relations };
  },
  async approveSelected(job_id: string, node_ids: string[], relation_ids: string[]) {
    const log = await loadSucceededLog(job_id);
    const nodes     = await NodeService.bulkUpdateStatusByIds(log.graph_id!, node_ids, 'approved');
    const relations = await RelationService.bulkUpdateStatusByIds(log.graph_id!, relation_ids, 'approved');
    return { ok: true, nodes, relations };
  },
  async rejectAll(job_id: string) {
    const log = await loadSucceededLog(job_id);
    const nodes     = await NodeService.bulkDeleteByJob(log.graph_id!, job_id);
    const relations = await RelationService.bulkDeleteByJob(log.graph_id!, job_id);
    return { ok: true, nodes, relations };
  },
};
```

**Step 3：routes 复用 Agent-F `ApproveBody`**

```ts
import { ApproveBody } from '@mkg/shared';

aiRouter.post('/jobs/:jobId/approve-all', requireRole('admin', 'expert'), async (req, res, next) => {
  try { res.json(await aiService.approveAll(req.params.jobId)); }
  catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code }); next(e); }
});

aiRouter.post('/jobs/:jobId/approve', requireRole('admin', 'expert'), async (req, res, next) => {
  try {
    const b = ApproveBody.parse(req.body);
    res.json(await aiService.approveSelected(req.params.jobId, b.node_ids, b.relation_ids));
  } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code }); next(e); }
});

aiRouter.post('/jobs/:jobId/reject-all', requireRole('admin', 'expert'), async (req, res, next) => {
  try { res.json(await aiService.rejectAll(req.params.jobId)); }
  catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code }); next(e); }
});
```

**Step 4：DoD**

- ✅ approve.test.ts 全部 7 条用例通过
- ✅ 三个端点都返回 `{ ok, nodes, relations }`，前端可统一 toast
- ✅ 状态机：仅 `success` 的 job 能 approve / reject

**Step 5：Commit**

```powershell
git add backend/src/modules/ai
git commit -m "feat(agent-c): approve/reject endpoints with state guard"
```

---

## Task 7：LLM 失败重试（区分错误类型 + 指数退避 + 测试）

**Files:**
- Modify: `backend/src/services/llm/llm.service.ts`
- Create: `backend/src/services/llm/__tests__/retry.test.ts`

**决策：**

LLM 调用失败有三类，处理策略不同：

| 错误类别 | 例子 | 是否重试 | 退避 |
|---|---|---|---|
| 暂时性 | 网络抖动、5xx、429、`AbortError`/timeout | ✅ 最多 2 次 | 500ms × 2^n + jitter |
| Schema 解析失败 | JSON 不合法 / Zod 校验失败 | ✅ 最多 1 次（提示 LLM `respond with valid JSON only`）| 不退避 |
| 鉴权类 | 401/403 invalid api key | ❌ 立即失败 | — |

**Step 1：实现 `withRetry`**

```ts
// llm.service.ts
export class LlmTransientError extends Error { constructor(msg: string, public cause?: unknown) { super(msg); } }
export class LlmAuthError      extends Error { constructor(msg: string, public cause?: unknown) { super(msg); } }
export class LlmParseError     extends Error { constructor(msg: string, public raw: string)    { super(msg); } }

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxAttempts: number; isRetryable: (e: unknown) => boolean; baseDelayMs?: number },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.maxAttempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (!opts.isRetryable(e) || i === opts.maxAttempts - 1) break;
      const delay = (opts.baseDelayMs ?? 500) * 2 ** i + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

const isTransient = (e: unknown) =>
  e instanceof LlmTransientError ||
  (e as any)?.name === 'AbortError' ||
  /ECONNRESET|ETIMEDOUT|fetch failed/.test(String((e as any)?.message ?? ''));

const isParseError = (e: unknown) => e instanceof LlmParseError;
```

**Step 2：在 chatCompletion 内分类抛错**

```ts
export async function chatCompletion(input: { system: string; user: string }) {
  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, { /* ... */ });
  if (res.status === 401 || res.status === 403) {
    throw new LlmAuthError(`LLM auth failed: ${res.status}`);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new LlmTransientError(`LLM transient: ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`LLM error: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content as string;
}
```

**Step 3：在 ai.service.generate 里组合**

```ts
// 网络层重试 2 次
const raw = await withRetry((i) => chatCompletion({ system, user }), {
  maxAttempts: 2,
  isRetryable: isTransient,
});

// 解析层重试 1 次（提示重发更严格）
let parsed: AIGenerateOutput;
try {
  parsed = AIGenerateOutput.parse(JSON.parse(raw));
} catch (e) {
  if (e instanceof SyntaxError || e instanceof ZodError) {
    const fix = await chatCompletion({
      system: system + '\nRespond with VALID JSON only, no prose.',
      user,
    });
    parsed = AIGenerateOutput.parse(JSON.parse(fix));
  } else {
    throw e;
  }
}
```

**Step 4：写 `retry.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, LlmTransientError, LlmAuthError } from '../llm.service';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('withRetry', () => {
  it('暂时性错误重试 2 次后成功', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n < 2) throw new LlmTransientError('boom');
      return 'ok';
    });
    const p = withRetry(fn, { maxAttempts: 3, isRetryable: (e) => e instanceof LlmTransientError, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect(await p).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('鉴权错误立即抛出，不重试', async () => {
    const fn = vi.fn(async () => { throw new LlmAuthError('401'); });
    await expect(
      withRetry(fn, { maxAttempts: 3, isRetryable: (e) => e instanceof LlmTransientError, baseDelayMs: 10 }),
    ).rejects.toBeInstanceOf(LlmAuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('达到 maxAttempts 抛最后一次错误', async () => {
    const fn = vi.fn(async () => { throw new LlmTransientError('still bad'); });
    const p = withRetry(fn, { maxAttempts: 2, isRetryable: () => true, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(LlmTransientError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

**Step 5：Commit**

```powershell
git add backend/src/services/llm
git commit -m "feat(agent-c): typed llm errors + exponential backoff retry"
```

**DoD：**
- ✅ retry.test.ts 3 条全过
- ✅ 401 / 403 不会进入重试循环
- ✅ 5xx / 429 / AbortError 走最多 2 次重试
- ✅ JSON 解析失败走 1 次重试且改写 system prompt

---

## Task 8：超长请求保护

**Files:**
- Modify: `backend/src/modules/ai/ai.routes.ts`
- Modify: `backend/src/services/llm/openai.client.ts`

**Step 1：在 `/generate` 上加超时（读取 env.LLM_TIMEOUT_MS）**

```ts
import { env } from '../../config/env';

aiRouter.post('/generate', requireRole('admin', 'expert'), async (req, res, next) => {
  req.setTimeout(env.LLM_TIMEOUT_MS);
  // ...原逻辑
});
```

**Step 2：在 fetch 上叠加 AbortSignal（防止 LLM 卡住把整个进程吊住）**

```ts
// openai.client.ts
const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
});
```

**Step 3：Commit**

```powershell
git add backend/src/modules/ai/ai.routes.ts
git commit -m "feat(agent-c): set 120s timeout on ai generate"
```

---

## Task 9：联调验证

**Step 1：在 Postman / curl 触发**

```powershell
# 1) 登录拿到 token
# 2) 创建图谱
# 3) 创建模板（使用设计文档 §4.2 的 system_prompt）
# 4) POST /api/ai/generate { template_id, variables: { course_name:'基础护理学', chapter_name:'静脉输液与输血', depth:'标准' }, graph_id }
# 5) GET /api/ai/jobs/:jobId 应返回 success + nodes_created/relations_created
# 6) GET /api/graphs/:id 能看到 candidate 节点
# 7) POST /api/ai/jobs/:jobId/approve-all
# 8) GET /api/graphs/:id 节点 status 全部为 approved
```

**Step 2：合并 PR**

`[Agent-C] AI 生成引擎 (sync mode, no queue)`

---

## Agent-C 完工标志

- [ ] `/api/ai/generate` 在 60s 内（GPT-4o-mini）能写入候选节点
- [ ] LLM 输出非法 JSON 时返回 400 且日志记录 `failed`
- [ ] approve-all / approve / reject-all 三接口工作正常
- [ ] 与 Agent-B 约定的 `ai_job_id` 字段写入 Neo4j 候选节点
- [ ] 单元测试覆盖率 ≥ 70%
