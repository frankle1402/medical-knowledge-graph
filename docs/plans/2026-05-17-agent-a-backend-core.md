# Agent-A — 后端核心 / Auth / PostgreSQL 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 搭建 backend 工作区的 Express 骨架，完成 PostgreSQL（Prisma）数据访问层、JWT 鉴权、用户与角色模块，以及 `prompt_templates`、`ai_generation_logs` 两张核心表与对应 API；为 Agent-B 的 Neo4j 路由、Agent-C 的 AI 流提供共享中间件与 schema 校验。

**架构（Architecture）:** Express 4 + 模块化路由（`backend/src/modules/<feature>`），所有路由经 `auth` 中间件做 JWT 校验与 RBAC；DB 层用 Prisma；请求/响应 DTO 全部从 `@mkg/shared` 引入并用 Zod 校验；错误统一通过 `errorHandler` 中间件转 JSON。

**技术栈:** Node 20 · Express 4 · Prisma 5 · PostgreSQL 16（本地原生）· bcryptjs（纯 JS，免 Windows VS Build Tools）· jsonwebtoken · zod · pino · vitest · supertest。

---

## 工作分支

`feature/agent-a-backend-core`

## 输出目录（仅本 Agent 可写）

- `backend/package.json`、`backend/tsconfig.json`、`backend/vitest.config.ts`
- `backend/src/index.ts`、`backend/src/app.ts`、`backend/src/server.ts`
- `backend/src/config/`
- `backend/src/middleware/`
- `backend/src/lib/`（logger、prisma client、jwt）
- `backend/src/modules/auth/`
- `backend/src/modules/users/`
- `backend/src/modules/templates/`
- `backend/src/modules/system/`（生成日志、配置）
- `backend/prisma/schema.prisma`、`backend/prisma/migrations/`
- `backend/prisma/seed.ts`

## 关键依赖

- ✅ Agent-G `Task 1-2` 完成（workspaces 与 ts 基础）
- ✅ Agent-F `Task 1, 2, 5` 完成（`@mkg/shared` 已发布枚举、`UserRole/User/JwtPayload/LoginInput`、`PromptTemplate`）
- ✅ 本地 PostgreSQL 16 已安装并能用 `psql -U postgres` 登录

---

## Task 1：`backend` workspace 骨架

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/index.ts`

**Step 1：写 `backend/package.json`**

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -b",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed.ts",
    "neo4j:init": "tsx src/scripts/neo4j-init.ts"
  },
  "dependencies": {
    "@mkg/shared": "*",
    "express": "4.21.0",
    "cors": "2.8.5",
    "helmet": "7.1.0",
    "dotenv": "16.4.5",
    "bcryptjs": "2.4.3",
    "jsonwebtoken": "9.0.2",
    "zod": "3.23.8",
    "pino": "9.4.0",
    "pino-http": "10.3.0",
    "@prisma/client": "5.20.0",
    "swagger-ui-express": "5.0.1",
    "yaml": "2.5.1"
  },
  "devDependencies": {
    "@types/express": "4.17.21",
    "@types/cors": "2.8.17",
    "@types/bcryptjs": "2.4.6",
    "@types/jsonwebtoken": "9.0.6",
    "@types/node": "20.16.5",
    "@types/supertest": "6.0.2",
    "@types/swagger-ui-express": "4.1.6",
    "tsx": "4.16.5",
    "typescript": "5.5.4",
    "prisma": "5.20.0",
    "supertest": "7.0.0",
    "vitest": "2.0.5"
  }
}
```

**Step 2：`backend/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "composite": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "prisma/seed.ts"],
  "references": [{ "path": "../shared" }]
}
```

**Step 3：`backend/vitest.config.ts`（含测试隔离 globalSetup）**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/__tests__/**', 'src/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
        // 鉴权与 RBAC 关键路径必须 100%
        'src/middleware/auth.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/jwt.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
```

**Step 3a：`backend/src/test/globalSetup.ts`（测试库一次性 reset，避免污染开发库）**

```ts
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // 1) 强制覆盖到测试库（即使 .env 漏配）
  if (!process.env.TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/knowledge_graph_test';
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  // 2) Neo4j 改连测试 database
  process.env.NEO4J_DATABASE = process.env.NEO4J_TEST_DATABASE ?? 'mkgtest';

  // 3) 用测试库重建 schema（drop + migrate + 不跑 seed）
  execSync('npx prisma migrate reset --force --skip-seed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
```

**Step 3b：`backend/src/test/setup.ts`（每个测试文件级别 hooks）**

```ts
import { afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { closeDriver } from '../lib/neo4j';

// 防泄漏：所有套件结束后断开 driver
afterAll(async () => {
  await prisma.$disconnect();
  await closeDriver();
});
```

> **重要约束**：
> - 测试库必须使用独立 PostgreSQL database `knowledge_graph_test` 与独立 Neo4j database `mkgtest`，由 Agent-G `infra/scripts/check-env.mjs` 一并校验存在。
> - 任何测试文件**禁止**直接对开发库 `knowledge_graph` 执行 `deleteMany / DETACH DELETE`，必须通过 globalSetup 切换到测试库。
> - Agent-A 的 `lib/neo4j.ts`（实际归 Agent-B 实现，本仓库由 Agent-A 引用）需读 `env.NEO4J_DATABASE` 作为 `session({ database })` 参数。

**Step 4：占位 `backend/src/index.ts`**

```ts
import './app';
console.log('backend bootstrapped');
```

**Step 5：装包**

Run: `npm install`
Expected: 无错误。

**Step 6：Commit**

```powershell
git add backend package.json package-lock.json
git commit -m "chore(agent-a): bootstrap backend workspace"
```

---

## Task 2：环境变量加载与配置模块

**Files:**
- Create: `backend/src/config/env.ts`
- Create: `backend/src/config/__tests__/env.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';

describe('env', () => {
  it('未设置 JWT_SECRET 时抛错', async () => {
    delete process.env.JWT_SECRET;
    await expect(import('../env?nocache=' + Date.now())).rejects.toThrow(/JWT_SECRET/);
  });
  it('正确读取 PORT 与 POSTGRES_URL', async () => {
    process.env.JWT_SECRET = 'x';
    process.env.POSTGRES_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.PORT = '4001';
    const mod = await import('../env?nocache=' + Date.now());
    expect(mod.env.PORT).toBe(4001);
    expect(mod.env.POSTGRES_URL).toContain('postgresql');
  });
});
```

**Step 2：跑测试看失败**

Run: `npm -w backend test src/config`
Expected: FAIL — 模块不存在。

**Step 3：实现 `env.ts`**

```ts
import 'dotenv/config';
import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET 必须设置'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  POSTGRES_URL: z.string().url(),
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('neo4j-password'),
  NEO4J_DATABASE: z.string().default('mkg'), // 测试时由 globalSetup 覆写为 mkgtest
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const env = Schema.parse(process.env);
```

**Step 4：跑测试通过**

Run: `npm -w backend test src/config`
Expected: PASS。

**Step 5：Commit**

```powershell
git add backend/src/config
git commit -m "feat(agent-a): add env config with zod validation"
```

---

## Task 3：Prisma schema 与首次 migration

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/.env`（仅本地，不提交）

**Step 1：写 `schema.prisma`（对应设计文档 §3.4）**

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}

model User {
  id            String   @id @default(uuid()) @db.Uuid
  username      String   @unique @db.VarChar(50)
  email         String   @unique @db.VarChar(100)
  password_hash String   @db.VarChar(255)
  role          String   @default("operator") @db.VarChar(20)
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now()) @db.Timestamptz
  templates     PromptTemplate[]
  ai_logs       AiGenerationLog[]

  @@map("users")
}

model PromptTemplate {
  id                   String   @id @default(uuid()) @db.Uuid
  name                 String   @db.VarChar(100)
  description          String?  @db.Text
  variables            Json     @default("[]")
  system_prompt        String   @db.Text
  user_prompt_template String   @db.Text
  output_schema        Json?
  is_active            Boolean  @default(true)
  created_by           String?  @db.Uuid
  created_at           DateTime @default(now()) @db.Timestamptz
  updated_at           DateTime @updatedAt @db.Timestamptz
  creator              User?    @relation(fields: [created_by], references: [id], onDelete: SetNull)
  ai_logs              AiGenerationLog[]

  @@map("prompt_templates")
}

model AiGenerationLog {
  id                String   @id @default(uuid()) @db.Uuid
  graph_id          String?  @db.VarChar(50)
  template_id       String?  @db.Uuid
  user_id           String?  @db.Uuid
  prompt_used       String?  @db.Text
  llm_response      String?  @db.Text
  nodes_created     Int      @default(0)
  relations_created Int      @default(0)
  status            String   @db.VarChar(20)
  error_msg         String?  @db.Text
  created_at        DateTime @default(now()) @db.Timestamptz
  template          PromptTemplate? @relation(fields: [template_id], references: [id], onDelete: SetNull)
  user              User?           @relation(fields: [user_id], references: [id], onDelete: SetNull)

  @@index([graph_id])
  @@index([status])
  @@index([created_at])
  @@map("ai_generation_logs")
}
```

**Step 2：本地 `backend/.env`（不提交，参考 `.env.example`）**

```
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/knowledge_graph
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/knowledge_graph_test
JWT_SECRET=change-me-in-production
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j-password
NEO4J_DATABASE=mkg
NEO4J_TEST_DATABASE=mkgtest
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-replace-me
LLM_MODEL=gpt-4o-mini
```

**Step 3：在 Postgres 中先建库**

Run（PowerShell）：
```powershell
psql -U postgres -c "CREATE DATABASE knowledge_graph;"
```
Expected：`CREATE DATABASE`。

**Step 4：跑首次 migration**

Run：`npm -w backend run db:migrate -- --name init`
Expected：生成 `backend/prisma/migrations/<timestamp>_init/`，输出 `Database is now in sync`。

**Step 5：Commit**

```powershell
git add backend/prisma
git commit -m "feat(agent-a): add prisma schema and init migration"
```

---

## Task 4：Prisma client 单例

**Files:**
- Create: `backend/src/lib/prisma.ts`
- Create: `backend/src/lib/__tests__/prisma.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../prisma';

describe('prisma', () => {
  it('能查询 User 表（即使为空也不抛错）', async () => {
    const all = await prisma.user.findMany();
    expect(Array.isArray(all)).toBe(true);
  });
});
```

**Step 2：实现**

```ts
import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
```

**Step 3：测试通过 + Commit**

```powershell
git add backend/src/lib/prisma.ts backend/src/lib/__tests__/prisma.test.ts
git commit -m "feat(agent-a): add prisma client singleton"
```

---

## Task 5：JWT 工具

**Files:**
- Create: `backend/src/lib/jwt.ts`
- Create: `backend/src/lib/__tests__/jwt.test.ts`

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../jwt';

describe('jwt', () => {
  it('签发并验证返回相同 payload', () => {
    const t = signToken({ sub: 'u1', role: 'admin' });
    const p = verifyToken(t);
    expect(p.sub).toBe('u1');
    expect(p.role).toBe('admin');
  });
  it('篡改的 token 验证抛错', () => {
    expect(() => verifyToken('not-a-token')).toThrow();
  });
});
```

**Step 2：实现**

```ts
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '@mkg/shared';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
```

**Step 3：测试通过 + Commit**

```powershell
git add backend/src/lib/jwt.ts backend/src/lib/__tests__/jwt.test.ts
git commit -m "feat(agent-a): add jwt sign/verify util"
```

---

## Task 6：Express app 骨架 + 中间件

**Files:**
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`
- Modify: `backend/src/index.ts`
- Create: `backend/src/lib/logger.ts`
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/errorHandler.ts`
- Create: `backend/src/middleware/__tests__/auth.test.ts`

**Step 1：`logger.ts`**

```ts
import pino from 'pino';
import { env } from '../config/env';
export const logger = pino({ level: env.LOG_LEVEL });
```

**Step 2：写 `middleware/auth.ts` 测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { requireAuth, requireRole } from '../auth';
import { signToken } from '../../lib/jwt';

function mockReqRes(headers: Record<string, string> = {}) {
  const req: any = { headers };
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

describe('auth middleware', () => {
  it('无 token → 401', () => {
    const { req, res, next } = mockReqRes();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('合法 token → 设置 req.user 并放行', () => {
    const token = signToken({ sub: 'u1', username: 'x', role: 'admin' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.role).toBe('admin');
  });
  it('requireRole 校验失败 → 403', () => {
    const token = signToken({ sub: 'u1', username: 'x', role: 'operator' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    requireAuth(req, res, () => {});
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
```

**Step 3：实现 `middleware/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt';
import type { UserRole } from '@mkg/shared';

declare module 'express-serve-static-core' {
  interface Request { user?: JwtPayload & { id: string }; }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  try {
    const payload = verifyToken(h.slice(7));
    // 同时挂 sub 与 id 两个键，兼容下游 req.user!.id 与 req.user!.sub
    req.user = { ...payload, id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  // 兼容 requireRole(['admin','expert']) 与 requireRole('admin','expert') 两种调用形式
  const flat = roles.flat() as UserRole[];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!flat.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
```

**Step 4：实现 `middleware/errorHandler.ts`**

```ts
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation_error', issues: err.issues });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'unique_violation' });
  }
  logger.error({ err }, 'unhandled error');
  res.status(err.status ?? 500).json({ error: err.message ?? 'internal_error' });
};
```

**Step 5：实现 `app.ts`**

```ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // ============== MOUNT-POINTS-START ==============
  // 各模块路由挂载点。本文件被 Agent-B/C/E/F 共享修改，**只允许在本注释块内追加**，
  // 禁止改动其他位置。每个 Agent 提交时仅 diff 自己那行，避免合并冲突。
  // app.use('/api/auth',      authRouter);      // Agent-A (本 Agent)
  // app.use('/api/users',     usersRouter);     // Agent-A
  // app.use('/api/templates', templatesRouter); // Agent-A
  // app.use('/api/system',    systemRouter);    // Agent-A (含 ai-logs / llm config)
  // app.use('/api/graphs',    graphRouter);     // Agent-B
  // app.use('/api/nodes',     nodeRouter);      // Agent-B
  // app.use('/api/relations', relationRouter);  // Agent-B
  // app.use('/api/ai',        aiRouter);        // Agent-C
  // ============== MOUNT-POINTS-END ================

  mountSwagger(app);

  app.use(errorHandler);
  return app;
}
```

**Step 6：实现 `server.ts` 与 `index.ts`**

```ts
// server.ts
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

const app = createApp();
app.listen(env.PORT, () => logger.info(`backend listening on ${env.PORT}`));
```

```ts
// index.ts
import './server';
```

**Step 7：测试通过 + 启动验证**

```powershell
npm -w backend test
npm -w backend run dev
curl.exe http://localhost:4000/api/health
```

Expected：`{"ok":true}`。

**Step 8：Commit**

```powershell
git add backend/src
git commit -m "feat(agent-a): add express app skeleton with auth/error middleware"
```

---

## Task 7：Auth 模块（登录）

**Files:**
- Create: `backend/src/modules/auth/auth.routes.ts`
- Create: `backend/src/modules/auth/auth.service.ts`
- Create: `backend/src/modules/auth/__tests__/auth.test.ts`
- Modify: `backend/src/app.ts`（mount `/api/auth`）

**Step 1：写测试（supertest）**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';

const app = createApp();

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: 'admin-test' } });
  await prisma.user.create({
    data: {
      username: 'admin-test',
      email: 'admin-test@example.com',
      password_hash: await bcrypt.hash('admin123', 10),
      role: 'admin',
    },
  });
});

describe('POST /api/auth/login', () => {
  it('成功返回 token + user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin-test', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('admin');
  });
  it('密码错误 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin-test', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

**Step 2：实现 service**

```ts
// auth.service.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { signToken } from '../../lib/jwt';
import type { UserRole } from '@mkg/shared';

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.is_active) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  const token = signToken({ sub: user.id, username: user.username, role: user.role as UserRole });
  return {
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  };
}
```

**Step 3：实现 routes**

```ts
// auth.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { login } from './auth.service';

export const authRouter = Router();

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const result = await login(body.username, body.password);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
```

**Step 4：在 `app.ts` mount**

```ts
import { authRouter } from './modules/auth/auth.routes';
// ...
app.use('/api/auth', authRouter);
```

**Step 5：测试通过 + Commit**

```powershell
git add backend/src/modules/auth backend/src/app.ts
git commit -m "feat(agent-a): add /api/auth/login"
```

---

## Task 8：种子脚本（默认管理员）

**Files:**
- Create: `backend/prisma/seed.ts`

**Step 1：实现**

```ts
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@example.com',
      password_hash: adminHash,
      role: 'admin',
    },
  });

  const expertHash = await bcrypt.hash('expert123', 10);
  await prisma.user.upsert({
    where: { username: 'expert' },
    update: {},
    create: {
      username: 'expert',
      email: 'expert@example.com',
      password_hash: expertHash,
      role: 'expert',
    },
  });

  const opHash = await bcrypt.hash('operator123', 10);
  await prisma.user.upsert({
    where: { username: 'operator' },
    update: {},
    create: {
      username: 'operator',
      email: 'operator@example.com',
      password_hash: opHash,
      role: 'operator',
    },
  });

  // 种入一个示例提示词模板（设计文档 §4.1 §4.2 §4.3）
  await prisma.promptTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: '医学课程章节知识图谱',
      description: '用于按课程+章节生成基础知识图谱',
      variables: [
        { key: 'course_name', label: '课程名称', type: 'text', required: true, placeholder: '如：基础护理学' },
        { key: 'chapter_name', label: '章节名称', type: 'text', required: true, placeholder: '如：静脉输液与输血' },
        {
          key: 'depth',
          label: '图谱详细程度',
          type: 'select',
          required: true,
          default: '标准',
          options: ['基础（仅核心知识点）', '标准（含操作步骤和术语）', '详细（含能力点、易混淆关系）'],
        },
      ],
      system_prompt: '你是一个医学教育知识图谱构建专家……（按设计文档 §4.2 完整粘贴）',
      user_prompt_template:
        '请为《{{course_name}}》中的「{{chapter_name}}」章节构建知识图谱。\n详细程度要求：{{depth}}\n\n要求：\n1. 覆盖该章节所有核心知识点\n2. 识别知识点之间的前置关系、易混淆关系\n3. 提取重要术语及其同义词\n4. 标注高频考点\n5. 每个节点的 confidence 字段反映你对该节点准确性的置信度（0-1）',
    },
  });

  console.log('✅ seed done');
}

main().finally(() => prisma.$disconnect());
```

**Step 2：执行**

Run：`npm -w backend run db:seed`
Expected：`✅ seed done`。

**Step 3：Commit**

```powershell
git add backend/prisma/seed.ts
git commit -m "feat(agent-a): add seed for default users and template"
```

---

## Task 9：Users 模块（管理员 CRUD）

**Files:**
- Create: `backend/src/modules/users/users.routes.ts`
- Create: `backend/src/modules/users/users.service.ts`
- Create: `backend/src/modules/users/__tests__/users.test.ts`
- Modify: `backend/src/app.ts`（在 MOUNT-POINTS 块内追加 `app.use('/api/users', usersRouter)`）

**契约（参考设计文档 §5.5）：**

| 方法 | 路径 | 角色 | Body | 200 / 201 响应 |
|---|---|---|---|---|
| GET    | `/api/users`             | admin | —                                      | `User[]`（不含 password_hash）|
| POST   | `/api/users`             | admin | `{ username, email, password, role }`  | `{ user_id, username, email, role, created_at }` |
| PUT    | `/api/users/:id/role`    | admin | `{ role: UserRole }`                   | 同上（更新后） |
| DELETE | `/api/users/:id`         | admin | —                                      | `{ ok: true }` |

错误响应统一 `{ error: string, code?: 'USERNAME_TAKEN' | 'NOT_FOUND' | 'CANNOT_DELETE_SELF' }`。

**Step 1：写测试**

```ts
// __tests__/users.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';
import bcrypt from 'bcryptjs';

const app = createApp();

describe('Users CRUD', () => {
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    await prisma.user.deleteMany();
    const adminHash = await bcrypt.hash('admin123', 10);
    const opHash = await bcrypt.hash('operator123', 10);
    const admin = await prisma.user.create({
      data: { username: 'admin', email: 'a@x.com', password_hash: adminHash, role: 'admin' },
    });
    const op = await prisma.user.create({
      data: { username: 'op', email: 'op@x.com', password_hash: opHash, role: 'operator' },
    });
    adminToken    = signToken({ id: admin.id, role: 'admin' });
    operatorToken = signToken({ id: op.id,    role: 'operator' });
  });

  it('未登录 → 401', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
  });
  it('operator → 403', async () => {
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${operatorToken}`)).status).toBe(403);
  });
  it('admin GET 列表', async () => {
    const r = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body[0].password_hash).toBeUndefined();
  });
  it('admin POST 新建', async () => {
    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'expert1', email: 'e1@x.com', password: 'pw123456', role: 'expert' });
    expect(r.status).toBe(201);
    expect(r.body.user_id).toBeTruthy();
  });
  it('用户名冲突 → 409 USERNAME_TAKEN', async () => {
    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'admin', email: 'x@x.com', password: 'pw123456', role: 'admin' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('USERNAME_TAKEN');
  });
  it('admin PUT role', async () => {
    const created = await prisma.user.findFirst({ where: { username: 'expert1' } });
    const r = await request(app)
      .put(`/api/users/${created!.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('operator');
  });
  it('不能删除自己 → 409', async () => {
    const me = await prisma.user.findFirst({ where: { username: 'admin' } });
    const r = await request(app).delete(`/api/users/${me!.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CANNOT_DELETE_SELF');
  });
});
```

**Step 2：实现 service**

```ts
// users.service.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import type { UserRole } from '@mkg/shared';

export const usersService = {
  list: () =>
    prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      select: { id: true, username: true, email: true, role: true, created_at: true },
    }),

  async create(input: { username: string; email: string; password: string; role: UserRole }) {
    const existing = await prisma.user.findUnique({ where: { username: input.username } });
    if (existing) throw new HttpError(409, 'USERNAME_TAKEN', '用户名已存在');
    const password_hash = await bcrypt.hash(input.password, 10);
    const u = await prisma.user.create({
      data: { ...input, password_hash },
      select: { id: true, username: true, email: true, role: true, created_at: true },
    });
    return { user_id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at };
  },

  async updateRole(id: string, role: UserRole) {
    const u = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, username: true, email: true, role: true, created_at: true },
    });
    return { user_id: u.id, ...u };
  },

  async remove(id: string, requesterId: string) {
    if (id === requesterId) throw new HttpError(409, 'CANNOT_DELETE_SELF', '无法删除自己');
    await prisma.user.delete({ where: { id } });
    return { ok: true };
  },
};

class HttpError extends Error {
  constructor(public status: number, public code: string, msg: string) { super(msg); }
}
export { HttpError };
```

**Step 3：实现 routes**

```ts
// users.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { usersService, HttpError } from './users.service';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

const CreateBody = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: UserRole,
});
const UpdateRoleBody = z.object({ role: UserRole });

usersRouter.get('/', async (_req, res, next) => {
  try { res.json(await usersService.list()); } catch (e) { next(e); }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateBody.parse(req.body);
    res.status(201).json(await usersService.create(body));
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});

usersRouter.put('/:id/role', async (req, res, next) => {
  try {
    const body = UpdateRoleBody.parse(req.body);
    res.json(await usersService.updateRole(req.params.id, body.role));
  } catch (e) { next(e); }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await usersService.remove(req.params.id, req.user!.id));
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});
```

**Step 4：跑测试通过 + Commit**

```powershell
npm -w backend test src/modules/users
git add backend/src/modules/users backend/src/app.ts
git commit -m "feat(agent-a): add admin users management"
```

**DoD：**
- ✅ 7 条用例（401 / 403 / 200 list / 201 create / 409 dup / 200 update / 409 self-delete）全部通过
- ✅ 列表响应不含 `password_hash`
- ✅ 路径与方法、错误 code 与契约表一致

---

## Task 10：Templates 模块（CRUD + 变量校验）

**Files:**
- Create: `backend/src/modules/templates/templates.routes.ts`
- Create: `backend/src/modules/templates/templates.service.ts`
- Create: `backend/src/modules/templates/__tests__/templates.test.ts`
- Modify: `backend/src/app.ts`（在 MOUNT-POINTS 块追加 `app.use('/api/templates', templatesRouter)`）

**契约（与 Agent-F `PromptTemplate` schema 严格对齐）：**

| 方法 | 路径 | 角色 | Body | 响应 |
|---|---|---|---|---|
| GET    | `/api/templates`        | 任何登录用户 | —                  | `PromptTemplate[]`（按 `created_at desc`，仅 `is_active=true`）|
| GET    | `/api/templates/:id`    | 任何登录用户 | —                  | `PromptTemplate` / 404 |
| POST   | `/api/templates`        | admin       | `PromptTemplateInput` | `PromptTemplate` / 201 |
| PUT    | `/api/templates/:id`    | admin       | `Partial<PromptTemplateInput>` | `PromptTemplate` / 200 |
| DELETE | `/api/templates/:id`    | admin       | —                  | `{ ok: true }`（软删，置 `is_active=false`）|

> `PromptTemplateInput = Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at' | 'is_active'>`，包含 `name / description / system_prompt / user_prompt / variables / output_schema / created_by`。`output_schema` 字段保留 JSON 原样存表，供 Agent-C 消费。

**Step 1：写测试**

```ts
// __tests__/templates.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();
const tplBody = {
  name: '基础护理学知识图谱',
  description: '示例',
  system_prompt: 'You are a medical KG expert.',
  user_prompt: '请为 {{course_name}} 的 {{chapter_name}} 生成图谱。',
  variables: [
    { key: 'course_name',  label: '课程名',  type: 'text',     required: true },
    { key: 'chapter_name', label: '章节名',  type: 'text',     required: true },
    { key: 'depth',        label: '深度',    type: 'select', options: ['标准', '扩展'], default: '标准' },
  ],
  output_schema: { type: 'object', properties: { nodes: { type: 'array' }, relations: { type: 'array' } } },
  created_by: '00000000-0000-0000-0000-000000000001',
};

describe('Templates CRUD', () => {
  let adminToken: string;
  let operatorToken: string;
  beforeAll(async () => {
    await prisma.promptTemplate.deleteMany();
    adminToken    = signToken({ id: '00000000-0000-0000-0000-000000000001', role: 'admin' });
    operatorToken = signToken({ id: '00000000-0000-0000-0000-000000000002', role: 'operator' });
  });

  it('admin 创建 → 201 → list 可查', async () => {
    const c = await request(app).post('/api/templates').set('Authorization', `Bearer ${adminToken}`).send(tplBody);
    expect(c.status).toBe(201);
    expect(c.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const l = await request(app).get('/api/templates').set('Authorization', `Bearer ${operatorToken}`);
    expect(l.status).toBe(200);
    expect(l.body.find((t: any) => t.id === c.body.id)).toBeTruthy();
  });

  it('operator 创建 → 403', async () => {
    const r = await request(app).post('/api/templates').set('Authorization', `Bearer ${operatorToken}`).send(tplBody);
    expect(r.status).toBe(403);
  });

  it('非法 variable.type → 400', async () => {
    const bad = { ...tplBody, name: 'bad', variables: [{ key: 'x', label: 'x', type: 'WRONG' as any }] };
    const r = await request(app).post('/api/templates').set('Authorization', `Bearer ${adminToken}`).send(bad);
    expect(r.status).toBe(400);
  });

  it('PUT 部分更新', async () => {
    const created = await prisma.promptTemplate.findFirstOrThrow();
    const r = await request(app)
      .put(`/api/templates/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'updated' });
    expect(r.status).toBe(200);
    expect(r.body.description).toBe('updated');
  });

  it('DELETE 软删（list 不再可见）', async () => {
    const created = await prisma.promptTemplate.findFirstOrThrow();
    const d = await request(app).delete(`/api/templates/${created.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(d.status).toBe(200);
    const l = await request(app).get('/api/templates').set('Authorization', `Bearer ${operatorToken}`);
    expect(l.body.find((t: any) => t.id === created.id)).toBeUndefined();
  });
});
```

**Step 2：实现 service**

```ts
// templates.service.ts
import { prisma } from '../../lib/prisma';
import type { PromptTemplate } from '@mkg/shared';

type Input = Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at' | 'is_active'>;

export const templatesService = {
  list: () =>
    prisma.promptTemplate.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    }),
  get: (id: string) =>
    prisma.promptTemplate.findUnique({ where: { id } }),
  create: (input: Input) =>
    prisma.promptTemplate.create({ data: { ...input, is_active: true } }),
  update: (id: string, patch: Partial<Input>) =>
    prisma.promptTemplate.update({ where: { id }, data: patch }),
  softDelete: (id: string) =>
    prisma.promptTemplate.update({ where: { id }, data: { is_active: false } }),
};
```

**Step 3：实现 routes（直接复用 Agent-F schema）**

```ts
// templates.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { PromptTemplate, TemplateVariable } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { templatesService } from './templates.service';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const InputBody = PromptTemplate.omit({ id: true, created_at: true, updated_at: true, is_active: true });
const PatchBody = InputBody.partial();

templatesRouter.get('/', async (_req, res, next) => {
  try { res.json(await templatesService.list()); } catch (e) { next(e); }
});

templatesRouter.get('/:id', async (req, res, next) => {
  try {
    const t = await templatesService.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json(t);
  } catch (e) { next(e); }
});

templatesRouter.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const body = InputBody.parse(req.body);
    res.status(201).json(await templatesService.create(body));
  } catch (e) { next(e); }
});

templatesRouter.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const patch = PatchBody.parse(req.body);
    res.json(await templatesService.update(req.params.id, patch));
  } catch (e) { next(e); }
});

templatesRouter.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await templatesService.softDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
```

**Step 4：验证 + Commit**

```powershell
npm -w backend test src/modules/templates
git add backend/src/modules/templates backend/src/app.ts
git commit -m "feat(agent-a): add prompt templates crud"
```

**DoD：**
- ✅ 5 条用例（admin create/list、operator create=403、非法 type=400、PUT 部分更新、DELETE 软删 list 不可见）通过
- ✅ list/get 响应字段顺序与 Agent-F `PromptTemplate` schema 一致
- ✅ Agent-C 通过 `prisma.promptTemplate.findUniqueOrThrow` 能消费 `system_prompt / user_prompt / variables / output_schema`

---

## Task 11：System / 配置模块（LLM 配置只读端点）

**Files:**
- Create: `backend/src/modules/system/system.routes.ts`
- Create: `backend/src/modules/system/__tests__/system.test.ts`

MVP 阶段 LLM 配置由 `.env` 维护，前端只读：

- `GET /api/system/llm` （admin）→ `{ base_url, model, api_key_set: boolean }`（**禁止**回显 API key）

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { signToken } from '../../../lib/jwt';

const adminToken = signToken({ sub: 'u-admin', username: 'admin', role: 'admin' });
const opToken = signToken({ sub: 'u-op', username: 'op', role: 'operator' });

describe('GET /api/system/llm', () => {
  const app = createApp();
  it('admin 可读', async () => {
    const r = await request(app).get('/api/system/llm').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ base_url: expect.any(String), model: expect.any(String), api_key_set: expect.any(Boolean) });
    expect(r.body.api_key).toBeUndefined();
  });
  it('operator 403', async () => {
    const r = await request(app).get('/api/system/llm').set('Authorization', `Bearer ${opToken}`);
    expect(r.status).toBe(403);
  });
});
```

**Step 2：实现**

```ts
import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { env } from '../../config/env';

export const systemRouter = Router();

systemRouter.get('/llm', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({
    base_url: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    api_key_set: Boolean(env.LLM_API_KEY && env.LLM_API_KEY.length > 0),
  });
});
```

**Step 3：测试通过 + Commit**

```powershell
git add backend/src/modules/system backend/src/app.ts
git commit -m "feat(agent-a): add system llm read-only endpoint"
```

---

## Task 12：AI 生成日志读取端点（给前端审核页用）

**Files:**
- Create: `backend/src/modules/system/ai-logs.routes.ts`
- Create: `backend/src/modules/system/ai-logs.service.ts`
- Create: `backend/src/modules/system/__tests__/ai-logs.test.ts`
- Modify: `backend/src/modules/system/index.ts`（导出 systemRouter，把 `ai-logs` 挂到 `/api/system/ai-logs`）

**契约：**

- `GET /api/system/ai-logs?graph_id=<uuid>&limit=<n>` — admin/expert
  - query：`graph_id`（可选，过滤），`limit`（默认 50，上限 200）
  - 200 response：`{ items: AIGenerationLog[], total: number }`
  - 401 未登录；403 角色不足

> ⚠️ 路由前缀为 `/api/system/ai-logs`，**不**放在 `/api/ai` 下，原因：`backend/src/modules/ai/` 整个目录由 Agent-C 拥有；Agent-A 只在自己 owned 的 `modules/system/` 内提供日志只读端点，避免多 Agent 写同一目录。

**Step 1：写测试**

```ts
// __tests__/ai-logs.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

describe('GET /api/system/ai-logs', () => {
  const app = createApp();
  let adminToken: string;
  let expertToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    await prisma.aiGenerationLog.deleteMany();
    await prisma.aiGenerationLog.createMany({
      data: [
        { id: 'log_1', graph_id: 'g_1', template_id: 't_1', user_id: 'u_1', status: 'success', nodes_created: 5, relations_created: 3, prompt_used: '', llm_response: '' },
        { id: 'log_2', graph_id: 'g_2', template_id: 't_1', user_id: 'u_1', status: 'failed',  nodes_created: 0, relations_created: 0, prompt_used: '', llm_response: '', error_msg: 'timeout' },
      ],
    });
    adminToken    = signToken({ id: 'u_a', role: 'admin' });
    expertToken   = signToken({ id: 'u_e', role: 'expert' });
    operatorToken = signToken({ id: 'u_o', role: 'operator' });
  });

  it('admin 可读取', async () => {
    const r = await request(app).get('/api/system/ai-logs').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(2);
    expect(r.body.total).toBe(2);
  });

  it('expert 可读取', async () => {
    const r = await request(app).get('/api/system/ai-logs').set('Authorization', `Bearer ${expertToken}`);
    expect(r.status).toBe(200);
  });

  it('operator 被 403', async () => {
    const r = await request(app).get('/api/system/ai-logs').set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(403);
  });

  it('无 token 401', async () => {
    const r = await request(app).get('/api/system/ai-logs');
    expect(r.status).toBe(401);
  });

  it('graph_id 过滤生效', async () => {
    const r = await request(app).get('/api/system/ai-logs?graph_id=g_1').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.items.every((x: any) => x.graph_id === 'g_1')).toBe(true);
  });

  it('limit 上限 200', async () => {
    const r = await request(app).get('/api/system/ai-logs?limit=999').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeLessThanOrEqual(200);
  });
});
```

**Step 2：实现 service + routes**

```ts
// ai-logs.service.ts
import { prisma } from '../../lib/prisma';

export const aiLogsService = {
  async list(opts: { graph_id?: string; limit: number }) {
    const where = opts.graph_id ? { graph_id: opts.graph_id } : {};
    const [items, total] = await Promise.all([
      prisma.aiGenerationLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: opts.limit,
      }),
      prisma.aiGenerationLog.count({ where }),
    ]);
    return { items, total };
  },
};
```

```ts
// ai-logs.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { aiLogsService } from './ai-logs.service';

export const aiLogsRouter = Router();
aiLogsRouter.use(requireAuth, requireRole('admin', 'expert'));

const Query = z.object({
  graph_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

aiLogsRouter.get('/', async (req, res, next) => {
  try {
    const q = Query.parse(req.query);
    const data = await aiLogsService.list(q);
    res.json(data);
  } catch (e) { next(e); }
});
```

```ts
// modules/system/index.ts
import { Router } from 'express';
import { aiLogsRouter } from './ai-logs.routes';
import { llmConfigRouter } from './llm-config.routes'; // Task 11

export const systemRouter = Router();
systemRouter.use('/ai-logs', aiLogsRouter);
systemRouter.use('/llm', llmConfigRouter);
```

**Step 3：验证 & Commit**

```powershell
npm -w backend test src/modules/system/__tests__/ai-logs.test.ts
git add backend/src/modules/system
git commit -m "feat(agent-a): GET /api/system/ai-logs with rbac and pagination"
```

**DoD：**
- ✅ admin 200、expert 200、operator 403、未登录 401 四条单测通过
- ✅ `graph_id` 过滤、`limit` 上限验证测试通过
- ✅ 响应形态稳定为 `{items, total}`

---

## Task 13：OpenAPI 文档挂载（消费 Agent-F 生成的 yaml）

**Files:**
- Create: `backend/src/lib/openapi.ts`
- Modify: `backend/src/app.ts`（mount `/api/docs`）

**契约（与 Agent-F Task 7 对齐）：** Agent-F 是 OpenAPI 单一真理源；Agent-F 用 `@asteasolutions/zod-to-openapi` 把所有 schema 注册并写入 `backend/openapi.yaml`。本 Task 不再重复注册，只负责"读取 yaml + 渲染 Swagger UI"。

**Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('GET /api/docs', () => {
  const app = createApp();
  it('返回 swagger UI HTML', async () => {
    const r = await request(app).get('/api/docs/').redirects(1);
    expect(r.status).toBe(200);
    expect(r.text).toContain('swagger-ui');
  });
});
```

**Step 2：实现 `lib/openapi.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import swaggerUi from 'swagger-ui-express';

const yamlPath = path.resolve(process.cwd(), 'backend/openapi.yaml');

export function mountSwagger(app: import('express').Express) {
  if (!fs.existsSync(yamlPath)) {
    // 开发期 Agent-F 未生成 yaml 时，给一个占位文档
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup({ openapi: '3.1.0', info: { title: 'MKG API', version: '0.0.0' }, paths: {} }));
    return;
  }
  const doc = yaml.parse(fs.readFileSync(yamlPath, 'utf8'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc));
}
```

**Step 3：在 `createApp` 中挂载（仅 NODE_ENV !== 'production' 或显式开启）**

```ts
import { mountSwagger } from './lib/openapi';
mountSwagger(app);
```

**Step 4：Commit**

```powershell
git add backend/src/lib/openapi.ts backend/src/app.ts
git commit -m "feat(agent-a): add openapi docs at /api/docs"
```

---

## Task 14：DoD 验证

**Step 1：本地全量回归**

```powershell
npm -w backend test
npm -w backend run dev
```

打开浏览器：

- `http://localhost:4000/api/health` → `{"ok":true}`
- `http://localhost:4000/api/docs` → Swagger UI 显示所有路由
- 用 admin/admin123 登录 `POST /api/auth/login` → 返回 token

**Step 2：合并 PR**

`[Agent-A] Backend skeleton + auth + users + templates`

---

## Agent-A 完工标志

- [ ] `npm -w backend run dev` 启动后 `/api/health` 返回 200
- [ ] `npm -w backend run db:migrate; if ($?) { npm -w backend run db:seed }` 一次跑通
- [ ] `/api/auth/login` 用三个种子账号都能拿到带 role 的 token
- [ ] `/api/users`、`/api/templates` 完整 CRUD + RBAC 全绿
- [ ] `ai_generation_logs` 表结构可被 Agent-C 写入
- [ ] `/api/docs` Swagger 页可访问
- [ ] 后端单测覆盖率 ≥ 70%