# Agent-H — QA / 联调 / E2E 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 维护跨 Agent 的集成测试体系：API 契约测试、Playwright E2E 主流程、性能基准、验收脚本；并在 GitHub Actions 中作为 PR 卡口。

**架构（Architecture）:** 独立 `e2e/` 目录使用 Playwright；后端集成测试用 supertest + 真实本地 Postgres/Neo4j（test 数据库）；性能用一个生成脚本灌 1000 节点 + 3000 边。`docs/testing/` 维护手工验收清单。

**技术栈:** Playwright 1.47 · supertest · k6（可选）· vitest · GitHub Actions。

---

## 工作分支

`feature/agent-h-qa`

## 输出目录（仅本 Agent 可写）

- `e2e/`
- `docs/testing/`
- `scripts/seed-large-graph.ts`
- `.github/workflows/e2e.yml`

## 关键依赖

- ✅ Agent-A、Agent-B、Agent-C 后端三套 API 已联通
- ✅ Agent-D、Agent-E 前端主流程跑通
- ✅ Agent-G 提供本地 Postgres/Neo4j 启动脚本

---

## Task 1：Playwright 工程骨架

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/tsconfig.json`
- Create: `e2e/.gitignore`

**Step 1：写 `e2e/package.json`**

```json
{
  "name": "e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report",
    "install-browsers": "playwright install chromium"
  },
  "devDependencies": {
    "@playwright/test": "1.47.2",
    "typescript": "5.5.4"
  }
}
```

**Step 2：`playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['html'], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

**Step 3：装包**

```powershell
cd e2e
npm install
npm run install-browsers
```

Expected：成功下载 Chromium。

**Step 4：Commit**

```powershell
git add e2e/package.json e2e/playwright.config.ts e2e/tsconfig.json e2e/.gitignore
git commit -m "chore(agent-h): bootstrap playwright workspace"
```

---

## Task 2：登录 E2E 测试

**Files:**
- Create: `e2e/tests/auth.spec.ts`

**Step 1：写测试**

```ts
import { test, expect } from '@playwright/test';

test('管理员登录 → 跳到图谱列表', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/graphs/);
  await expect(page.getByRole('heading', { name: /我的图谱/ })).toBeVisible();
});

test('密码错误显示提示', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('wrong');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(/账号或密码/)).toBeVisible();
});
```

**Step 2：跑测试**

启动前后端后：

```powershell
Push-Location e2e; npm test -- auth.spec.ts; Pop-Location
```

Expected: 2 PASS（前提：后端已种入 admin 账号）。

**Step 3：Commit**

```powershell
git add e2e/tests/auth.spec.ts
git commit -m "test(agent-h): add login e2e"
```

---

## Task 3：图谱 CRUD E2E

**Files:**
- Create: `e2e/tests/graph-crud.spec.ts`
- Create: `e2e/fixtures/auth.ts`

**Step 1：复用登录的 fixture**

```ts
// e2e/fixtures/auth.ts
import { test as base } from '@playwright/test';

export const test = base.extend<{ loggedInPage: any }>({
  loggedInPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByLabel('用户名').fill('admin');
    await page.getByLabel('密码').fill('admin123');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(/\/graphs/);
    await use(page);
  },
});
```

**Step 2：写 CRUD 测试**

```ts
import { test } from '../fixtures/auth';
import { expect } from '@playwright/test';

test('创建 → 编辑 → 删除图谱', async ({ loggedInPage: page }) => {
  // 创建
  await page.getByRole('button', { name: /新建图谱/ }).click();
  await page.getByLabel('图谱名称').fill('E2E 测试图谱');
  await page.getByLabel('类型').selectOption('course');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByText('E2E 测试图谱')).toBeVisible();

  // 进入编辑
  await page.getByRole('link', { name: /E2E 测试图谱/ }).click();
  await expect(page).toHaveURL(/\/edit$/);

  // 添加节点（右键画布）
  const canvas = page.locator('.react-flow__pane');
  await canvas.click({ button: 'right', position: { x: 200, y: 200 } });
  await page.getByRole('menuitem', { name: '添加节点' }).click();
  await page.getByLabel('名称').fill('静脉输液');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: '静脉输液' })).toBeVisible();

  // 删除图谱
  await page.goto('/graphs');
  await page.getByRole('button', { name: /删除/ }).first().click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('E2E 测试图谱')).not.toBeVisible();
});
```

**Step 3：Commit**

```powershell
git add e2e/fixtures e2e/tests/graph-crud.spec.ts
git commit -m "test(agent-h): add graph crud e2e"
```

---

## Task 4：AI 生成 + 审核 E2E

**Files:**
- Create: `e2e/tests/ai-generate.spec.ts`
- Create: `e2e/mock-llm.ts`（mock LLM 服务）
- Create: `e2e/global-setup.ts`（启动 mock-llm + 等待就绪）
- Modify: `e2e/playwright.config.ts`（注册 globalSetup / globalTeardown）

**Step 1：实现 `e2e/mock-llm.ts`（OpenAI 兼容最小桩）**

```ts
// e2e/mock-llm.ts
import http from 'node:http';
import { AddressInfo } from 'node:net';

const FIXED_GRAPH = {
  nodes: [
    { node_type: 'knowledge_point', name: '静脉输液',  description: '将药液经静脉持续滴入', confidence: 0.95 },
    { node_type: 'knowledge_point', name: '输血反应',  description: '常见免疫性反应',     confidence: 0.93 },
    { node_type: 'operation_step',  name: '排气',      description: '排尽输液管中空气',   confidence: 0.99 },
    { node_type: 'term',            name: '肝素帽',    description: '一次性密闭装置',     confidence: 0.97 },
  ],
  relations: [
    { source: '静脉输液', target: '排气',     relation_type: 'INCLUDES_STEP' },
    { source: '静脉输液', target: '输血反应', relation_type: 'RELATED_TO' },
    { source: '静脉输液', target: '肝素帽',   relation_type: 'USES_TOOL' },
  ],
};

export function startMockLlm(port = Number(process.env.MOCK_LLM_PORT ?? 9999)) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'mock-' + Date.now(),
          choices: [{
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(FIXED_GRAPH) },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        }));
      });
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${actual}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (require.main === module) {
  startMockLlm().then(({ url }) => console.log(`[mock-llm] ready at ${url}`));
}
```

**Step 2：实现 `e2e/global-setup.ts`**

```ts
// e2e/global-setup.ts
import { startMockLlm } from './mock-llm';

let stop: (() => Promise<void>) | null = null;

export default async function globalSetup() {
  const { url, close } = await startMockLlm();
  process.env.LLM_BASE_URL = url;
  process.env.LLM_API_KEY  = 'sk-mock';
  process.env.LLM_MODEL    = 'mock-model';
  stop = close;
  // 写到一个文件让 teardown 读取
  process.env.__MOCK_LLM_RUNNING__ = '1';
  return async () => { if (stop) await stop(); };
}
```

> **关键**：`backend` 进程必须在 mock-llm 启动**之后**才能起，否则 `LLM_BASE_URL` 不生效。修改 `playwright.config.ts`：

```ts
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: require.resolve('./global-setup'),
  webServer: [
    {
      command: 'npm -w backend run start',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      // 由 global-setup 注入 LLM_BASE_URL 等到本进程，再 spawn webServer 时继承
      env: {
        LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'http://127.0.0.1:9999/v1',
        LLM_API_KEY:  'sk-mock',
        LLM_MODEL:    'mock-model',
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/knowledge_graph_test',
        NEO4J_DATABASE: 'mkgtest',
      },
      timeout: 120_000,
    },
    {
      command: 'npm -w frontend run preview -- --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
});
```

> 因为 webServer 会先于 globalSetup 启动一次，所以 globalSetup 端口是固定的 9999（来自 env 默认值）；mock-llm 在 globalSetup 内同样监听 9999。这样 backend 第一次 fetch 时已经有人接收。

**Step 3：写测试**

```ts
// e2e/tests/ai-generate.spec.ts
import { test } from '../fixtures/auth';
import { expect } from '@playwright/test';

test('AI 生成 → 一键确认', async ({ loggedInPage: page }) => {
  await page.goto('/graphs');
  await page.getByRole('button', { name: /新建图谱/ }).click();
  await page.getByLabel('图谱名称').fill('AI 测试图谱');
  await page.getByRole('button', { name: '创建' }).click();
  await page.getByRole('link', { name: /AI 测试图谱/ }).click();

  await page.getByRole('button', { name: /AI 生成图谱/ }).click();
  await page.getByLabel('选择模板').selectOption({ label: '医学课程章节知识图谱' });
  await page.getByLabel('课程名称').fill('基础护理学');
  await page.getByLabel('章节名称').fill('静脉输液与输血');
  await page.getByRole('button', { name: '开始生成' }).click();

  // mock-llm 立即返回固定 4 节点 / 3 关系
  await expect(page.getByText(/AI 生成结果/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/4 节点/)).toBeVisible();

  await page.getByRole('button', { name: '一键全部确认' }).click();
  await expect(page.locator('.react-flow__node[data-status="candidate"]')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});
```

**Step 4：Commit**

```powershell
git add e2e/tests/ai-generate.spec.ts e2e/mock-llm.ts e2e/global-setup.ts e2e/playwright.config.ts
git commit -m "test(agent-h): mock-llm + e2e for ai generate + review"
```

**DoD：**
- ✅ `npx playwright test ai-generate` 在干净 `mkgtest` 上 < 30s 通过
- ✅ backend 进程没有真正访问 OpenAI（看 mock-llm 日志确认收到 1 次 POST）
- ✅ 即使本机断网，测试仍然通过

---

## Task 5：性能基准（1000 节点 + 3000 边）

**Files:**
- Create: `scripts/seed-large-graph.ts`
- Create: `e2e/tests/perf.spec.ts`

**Step 1：写灌数据脚本**

```ts
// scripts/seed-large-graph.ts
import 'dotenv/config';
import { runQuery, closeDriver } from '../backend/src/lib/neo4j';

async function main() {
  const graphId = 'graph_perf';
  await runQuery(
    'MERGE (g:Graph {graph_id:$id}) SET g.graph_name=$name, g.graph_type="custom"',
    { id: graphId, name: '性能压测图谱' },
  );
  // 1000 节点
  await runQuery(
    `UNWIND range(1,1000) AS i
     MERGE (n:Node {node_id:'PERF_KP_'+i})
     SET n.node_type='knowledge_point', n.name='节点'+i, n.status='approved'
     WITH n
     MATCH (g:Graph {graph_id:$id}) MERGE (n)-[:BELONGS_TO_GRAPH]->(g)`,
    { id: graphId },
  );
  // 3000 边（随机 source!=target）
  await runQuery(
    `UNWIND range(1,3000) AS i
     WITH i, toInteger(rand()*1000)+1 AS a, toInteger(rand()*1000)+1 AS b
     MATCH (s:Node {node_id:'PERF_KP_'+a}), (t:Node {node_id:'PERF_KP_'+b})
     WHERE s<>t
     MERGE (s)-[:RELATED_TO]->(t)`,
  );
  console.log('✅ seeded 1000 nodes + ~3000 edges');
  await closeDriver();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Step 2：性能测试**

```ts
// e2e/tests/perf.spec.ts
import { test, expect } from '@playwright/test';
test('1000 节点图谱在 5 秒内加载完成', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();

  const start = Date.now();
  await page.goto('/graphs/graph_perf/edit');
  await page.waitForSelector('.react-flow__node', { timeout: 10_000 });
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(5000);
});
```

**Step 3：Commit**

```powershell
git add scripts/seed-large-graph.ts e2e/tests/perf.spec.ts
git commit -m "test(agent-h): add 1k node perf benchmark"
```

---

## Task 6：API 契约/集成测试

**Files:**
- Create: `backend/src/__tests__/integration/graphs.test.ts`

**Step 1：写测试（使用 supertest 与真实 Postgres + Neo4j 测试库）**

> 测试隔离前置：`backend/vitest.config.ts` 的 `globalSetup` 已把 `DATABASE_URL` 切到 `knowledge_graph_test`、`NEO4J_DATABASE` 切到 `mkgtest`，并 `prisma migrate reset --force --skip-seed`。本文件直接 `createApp()` 即接入测试库。

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';

const app = createApp();
let token: string;

beforeAll(async () => {
  // 用 globalSetup 写入的 admin seed
  const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
  token = r.body.token;
});

describe('/api/graphs (integration)', () => {
  it('POST 创建图谱 → GET 列表能看到', async () => {
    const c = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${token}`)
      .send({ graph_name: '集成测试图谱', graph_type: 'course' });
    expect(c.status).toBe(201);
    const id = c.body.graph_id;

    const list = await request(app).get('/api/graphs').set('Authorization', `Bearer ${token}`);
    expect(list.body.find((g: any) => g.graph_id === id)).toBeTruthy();
  });
});
```

**Step 2：Commit**

```powershell
git add backend/src/__tests__/integration
git commit -m "test(agent-h): add api integration tests"
```

---

## Task 7：GitHub Actions E2E 工作流

**Files:**
- Create: `.github/workflows/e2e.yml`

**Step 1：写 workflow**

```yaml
name: e2e

on:
  pull_request:
    branches: [develop, main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: knowledge_graph_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
      neo4j:
        image: neo4j:5
        env:
          NEO4J_AUTH: neo4j/neo4j-password
        ports: ['7687:7687', '7474:7474']
        options: >-
          --health-cmd "cypher-shell -u neo4j -p neo4j-password 'RETURN 1' || exit 1"
          --health-interval 10s
          --health-timeout 10s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm -w backend run db:migrate
        env:
          POSTGRES_URL: postgresql://postgres:postgres@localhost:5432/knowledge_graph_test
      - run: npm -w backend run db:seed
        env:
          POSTGRES_URL: postgresql://postgres:postgres@localhost:5432/knowledge_graph_test
      - run: npm -w backend run neo4j:init
      - run: npm run build
      - name: Start services
        run: |
          npm -w backend run start &
          npm -w frontend run preview -- --port 3000 &
          npx wait-on http://localhost:4000/api/health http://localhost:3000
      - name: Install e2e deps
        working-directory: e2e
        run: |
          npm ci
          npx playwright install chromium
      - name: Run Playwright
        working-directory: e2e
        run: npm test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report
```

> ❗ 注意：CI 使用容器化的 Postgres/Neo4j 是为了自动化跑测；本地开发不需要 Docker。

**Step 2：Commit**

```powershell
git add .github/workflows/e2e.yml
git commit -m "ci(agent-h): add e2e workflow"
```

---

## Task 8：手工验收清单

**Files:**
- Create: `docs/testing/uat-checklist.md`

**Step 1：写清单**

```markdown
# UAT 验收清单

## 1. 登录与权限
- [ ] admin 登录成功，能看到全部菜单
- [ ] expert 登录后看不到「模板/用户/设置」
- [ ] operator 登录后无「新建图谱」按钮
- [ ] 退出后回到 /login

## 2. 图谱 CRUD
- [ ] 新建图谱（course / chapter / subject / custom 四种类型均可创建）
- [ ] 在编辑器添加 5 个不同类型节点 + 5 条不同类型关系
- [ ] 刷新后数据持久化
- [ ] 删除图谱后列表不再显示

## 3. AI 生成
- [ ] 模板列表至少有 1 个内置模板
- [ ] 选择模板填写课程/章节后生成
- [ ] 生成结果以橙色显示在画布上
- [ ] 一键全部确认 → 节点变为对应颜色
- [ ] 逐条审核：通过部分，剩余仍为候选

## 4. 导出
- [ ] 导出 JSON 文件结构正确（基础字段齐全）

## 5. 性能
- [ ] 1000 节点编辑器流畅（FPS ≥ 30）
- [ ] API P95 < 500ms（除 AI 生成外）

## 6. 多角色串测
- [ ] expert 能编辑 admin 创建的图谱
- [ ] operator 仅能查看与导出，不能编辑
```

**Step 2：Commit**

```powershell
git add docs/testing
git commit -m "docs(agent-h): add UAT checklist"
```

---

## Task 9：DoD 验证

**Step 1：本地全量回归**

```powershell
npm run typecheck
npm run lint
npm run test            # 所有 workspace 单测
npm -w backend run test # 集成测试
cd e2e && npm test
```

Expected: 全绿。

**Step 2：合并 PR**

`[Agent-H] E2E + integration tests + UAT checklist`

---

## Agent-H 完工标志

- [ ] Playwright 主流程脚本（auth / crud / ai-generate / perf）全部稳定通过
- [ ] 后端集成测试覆盖三大模块（auth / graphs / ai）
- [ ] CI 在 PR 上跑 E2E 全绿
- [ ] UAT 清单已交付给业务确认
- [ ] 性能基准达标（1000 节点 < 5s 加载，FPS ≥ 30）
