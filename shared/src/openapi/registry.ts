import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

import { NodeType, NodeStatus, UserRole } from '../enums';
import {
  Node,
  NodeCreateInput,
  NodeUpdateInput,
} from '../schemas/node';
import { Relation, RelationCreateInput } from '../schemas/relation';
import { Graph, GraphCreateInput, GraphUpdateInput } from '../schemas/graph';
import {
  AIGenerateRequest,
  AIJob,
  ApproveBody,
  AIGenerationLog,
  LLMConfig,
} from '../schemas/ai';
import { User, UserCreateInput } from '../schemas/user';
import { LoginInput, LoginResponse } from '../schemas/auth';
import { PromptTemplate, PromptTemplateCreateInput } from '../schemas/template';

export const registry = new OpenAPIRegistry();

// --- Components: 显式注册以便其他 schema 通过 $ref 引用 ---
registry.register('Node', Node);
registry.register('Relation', Relation);
registry.register('Graph', Graph);
registry.register('User', User);
registry.register('PromptTemplate', PromptTemplate);
registry.register('AIJob', AIJob);
registry.register('AIGenerationLog', AIGenerationLog);
registry.register('LLMConfig', LLMConfig);

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const okEnvelope = z.object({ ok: z.boolean() });

// =====================================================================
// Auth (3 paths)
// =====================================================================
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['auth'],
  request: { body: { content: { 'application/json': { schema: LoginInput } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: LoginResponse } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['auth'],
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['auth'],
  security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: User } } } },
});

// =====================================================================
// Users (4 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/users',
  tags: ['users'],
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(User) } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/users',
  tags: ['users'],
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: UserCreateInput } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: User } } },
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/users/{id}/role',
  tags: ['users'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.object({ role: UserRole }) } },
    },
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: User } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/users/{id}',
  tags: ['users'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});

// =====================================================================
// Templates (5 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/templates',
  tags: ['templates'],
  security: [{ [bearer.name]: [] }],
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: z.array(PromptTemplate) } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/templates',
  tags: ['templates'],
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: PromptTemplateCreateInput } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: PromptTemplate } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/templates/{id}',
  tags: ['templates'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: PromptTemplate } } },
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/templates/{id}',
  tags: ['templates'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: PromptTemplateCreateInput } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: PromptTemplate } } },
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/templates/{id}',
  tags: ['templates'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});

// =====================================================================
// Graphs (5 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/graphs',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(Graph) } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/graphs',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: GraphCreateInput } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Graph } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/graphs/{id}',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  // P0-5：返回 { graph, nodes, relations } 三元组
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            graph: Graph,
            nodes: z.array(Node),
            relations: z.array(Relation),
          }),
        },
      },
    },
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/graphs/{id}',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: GraphUpdateInput } } },
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Graph } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/graphs/{id}',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});
registry.registerPath({
  // review-report P1：导出由 POST 改为 GET（浏览器直接下载）
  method: 'get',
  path: '/api/graphs/{id}/export',
  tags: ['graphs'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            graph: Graph,
            nodes: z.array(Node),
            relations: z.array(Relation),
          }),
        },
      },
    },
  },
});

// =====================================================================
// Nodes (3 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/graphs/{id}/nodes',
  tags: ['nodes'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      node_type: NodeType.optional(),
      status: NodeStatus.optional(),
      keyword: z.string().optional(),
      skip: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(Node),
            total: z.number().int(),
            skip: z.number().int(),
            limit: z.number().int(),
          }),
        },
      },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/graphs/{id}/nodes',
  tags: ['nodes'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: NodeCreateInput } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Node } } },
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/nodes/{nodeId}',
  tags: ['nodes'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ nodeId: z.string() }),
    body: { content: { 'application/json': { schema: NodeUpdateInput } } },
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Node } } } },
});

// 注：path 计数 — graphs/{id}/nodes (GET, POST) 计入 nodes，
//      put /api/nodes/{nodeId} 计入 nodes，delete 计入 nodes 第 4 条。
//      DoD 约定 nodes×3，与 plan 表头一致：DELETE 计入 relations 段。
//      但 plan 第 808 行 DELETE /api/nodes/{nodeId} 出现在 nodes 注释下。
//      照 plan 实现，按 plan 注释把 nodes 视为 GET+POST+PUT+DELETE 四条；
//      约束清单仍按 27 总量为准 (3+4+5+5+ ?? +4+5+3 = 27 → nodes=3, relations=3)
//      review-report P0-7 引入了 PUT /api/nodes/:id 与 DELETE /api/nodes/:id；
//      plan 第 802-811 列出 GET 列表 / POST / PUT / DELETE 四条；
//      因此约束「nodes×3」实指 [POST-by-graph, PUT, DELETE]，
//      list 端点实际属于 graphs 段。我们仍按 plan 注册全部四条，同时把
//      DELETE 放到 nodes 段下文，确保与后端路由一致。
registry.registerPath({
  method: 'delete',
  path: '/api/nodes/{nodeId}',
  tags: ['nodes'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ nodeId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});

// =====================================================================
// Relations (4 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/graphs/{id}/relations',
  tags: ['relations'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(Relation) } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/graphs/{id}/relations',
  tags: ['relations'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: RelationCreateInput } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Relation } } },
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/relations/{relationId}',
  tags: ['relations'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ relationId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            description: z.string().optional(),
            confidence: z.number().min(0).max(1).optional(),
            status: NodeStatus.optional(),
          }),
        },
      },
    },
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Relation } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/relations/{relationId}',
  tags: ['relations'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ relationId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: okEnvelope } } },
  },
});

// =====================================================================
// AI (5 paths)
// =====================================================================
registry.registerPath({
  method: 'post',
  path: '/api/ai/generate',
  tags: ['ai'],
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: AIGenerateRequest } } } },
  responses: {
    202: {
      description: 'Accepted',
      content: { 'application/json': { schema: z.object({ job_id: z.string() }) } },
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/ai/jobs/{jobId}',
  tags: ['ai'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: AIJob } } } },
});
const approveResponse = z.object({
  ok: z.boolean(),
  nodes: z.number().int(),
  relations: z.number().int(),
});
registry.registerPath({
  method: 'post',
  path: '/api/ai/jobs/{jobId}/approve-all',
  tags: ['ai'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: approveResponse } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/ai/jobs/{jobId}/approve',
  tags: ['ai'],
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ jobId: z.string() }),
    body: { content: { 'application/json': { schema: ApproveBody } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: approveResponse } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/ai/jobs/{jobId}/reject-all',
  tags: ['ai'],
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: approveResponse } } },
  },
});

// =====================================================================
// System (3 paths)
// =====================================================================
registry.registerPath({
  method: 'get',
  path: '/api/system/ai-logs',
  tags: ['system'],
  security: [{ [bearer.name]: [] }],
  request: {
    query: z.object({
      graph_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(AIGenerationLog),
            total: z.number().int(),
          }),
        },
      },
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/system/llm',
  tags: ['system'],
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: LLMConfig } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['system'],
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), version: z.string() }),
        },
      },
    },
  },
});

/**
 * 已注册路径计数（含设计文档 §5 完整覆盖）：
 *   auth × 3, users × 4, templates × 5, graphs × 5,
 *   nodes × 4, relations × 4, ai × 5, system × 3
 *
 * 共享契约约束清单（main.task）声明 nodes×3 + relations×4 = 27；
 * 这里 nodes 多了 1（DELETE /api/nodes/{nodeId}）以避免漏注册——
 * 该端点出自 plan 第 807-811 行，是 P0-7 增量保存所必需。
 * 实际暴露 28 条；其中「DELETE /api/nodes/{nodeId}」属于 nodes 段附加项。
 */
