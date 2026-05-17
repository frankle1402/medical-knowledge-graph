# Agent-G — 本地开发环境 / 工程基建实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 搭建一个**不依赖 Docker** 的本地开发工程：Monorepo 骨架、本地原生 PostgreSQL 16、Neo4j 5 Community、统一规范与 CI；将来正式部署时再补 Docker 镜像（不在 MVP 范围）。

**架构（Architecture）:** npm workspaces 管理 `frontend / backend / shared` 三包；后端用 `tsx watch` 直连本地 Postgres、Neo4j；前端用 Vite dev server；`concurrently` 一键启动两个 dev 进程；MVP 阶段 AI 生成走同步请求，**不引入 Redis/队列**。

**技术栈:** npm workspaces · TypeScript 5.5 · Node 20 LTS · 本地 PostgreSQL 16 · 本地 Neo4j 5 Community · GitHub Actions · ESLint + Prettier · Husky + lint-staged · concurrently · tsx · dotenv-cli。

---

## 工作分支

`feature/agent-g-infra`

## 输出目录（仅本 Agent 可写）

- 仓库根：`package.json`, `.gitignore`, `.gitattributes`, `.editorconfig`, `tsconfig.base.json`, `tsconfig.json`, `.prettierrc`, `.eslintrc.cjs`, `.eslintignore`, `.env.example`, `README.md`
- `infra/`（**仅放本地启动脚本与说明**，不放 Dockerfile）
- `.github/workflows/`
- `.husky/`

> ❗ MVP 阶段**不写** `docker-compose.yml` 和 `Dockerfile`。正式部署时再单独立项。

---

## Task 1：根 `package.json` 与 workspaces

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `.editorconfig`

**Step 1：写根 `package.json`**

```json
{
  "name": "medical-knowledge-graph",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["shared", "backend", "frontend"],
  "scripts": {
    "dev": "concurrently -n backend,frontend -c blue,green \"npm -w backend run dev\" \"npm -w frontend run dev\"",
    "dev:backend": "npm -w backend run dev",
    "dev:frontend": "npm -w frontend run dev",
    "build": "npm -w shared run build && npm -w backend run build && npm -w frontend run build",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc -b",
    "test": "npm -w backend test && npm -w frontend test && npm -w @mkg/shared test",
    "db:migrate": "npm -w backend run db:migrate",
    "db:seed": "npm -w backend run db:seed",
    "neo4j:init": "npm -w backend run neo4j:init",
    "prepare": "husky"
  },
  "devDependencies": {
    "concurrently": "8.2.2",
    "eslint": "8.57.0",
    "@typescript-eslint/parser": "7.18.0",
    "@typescript-eslint/eslint-plugin": "7.18.0",
    "prettier": "3.3.3",
    "husky": "9.1.6",
    "lint-staged": "15.2.10",
    "typescript": "5.5.4"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml}": ["prettier --write"]
  },
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

**Step 2：`.gitignore`**

```
node_modules
dist
build
.env
.env.local
*.log
coverage
.vscode
.idea
.DS_Store
e2e/test-results
e2e/playwright-report
backend/prisma/migrations/dev.db*
```

**Step 3：`.gitattributes`（Windows 换行兼容）**

```
* text=auto eol=lf
*.sh text eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

**Step 4：`.editorconfig`**

```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
[*.{cmd,bat,ps1}]
end_of_line = crlf
```

**Step 5：跑 install**

Run: `npm install`
Expected: 创建 `node_modules` 与 `package-lock.json`，无错误。

**Step 6：Commit**

```powershell
git add package.json package-lock.json .gitignore .gitattributes .editorconfig
git commit -m "chore(agent-g): bootstrap monorepo workspaces"
```

---

## Task 2：根 TS / Lint / Prettier 配置

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `.prettierrc`
- Create: `.eslintrc.cjs`
- Create: `.eslintignore`

**Step 1：`tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "useUnknownInCatchVariables": true,
    "baseUrl": "."
  }
}
```

**Step 2：根 `tsconfig.json`（references）**

```json
{
  "files": [],
  "references": [
    { "path": "./shared" },
    { "path": "./backend" },
    { "path": "./frontend" }
  ]
}
```

**Step 3：`.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

**Step 4：`.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2022: true },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  ignorePatterns: ['dist', 'build', 'node_modules', 'coverage'],
};
```

**Step 5：`.eslintignore`**

```
dist
build
node_modules
coverage
*.config.js
*.config.ts
```

**Step 6：Commit**

```powershell
git add tsconfig.base.json tsconfig.json .prettierrc .eslintrc.cjs .eslintignore
git commit -m "chore(agent-g): add ts/eslint/prettier base configs"
```

---

## Task 3：Husky + lint-staged 钩子

**Files:**
- Create: `.husky/pre-commit`

**Step 1：初始化**

Run: `npx husky init`

**Step 2：写入 `.husky/pre-commit`**

```sh
npx lint-staged
```

**Step 3：Commit**

```powershell
git add .husky package.json
git commit -m "chore(agent-g): add husky pre-commit hook"
```

---

## Task 4：根 `.env.example`（本地原生连接串）

**Files:**
- Create: `.env.example`

**Step 1：写入**

```
# ====== Backend ======
PORT=4000
NODE_ENV=development
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=12h

# ====== PostgreSQL（本地原生）======
# 安装好 Postgres 16 后，使用本地 5432 端口
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/knowledge_graph
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/knowledge_graph_test

# ====== Neo4j（本地 Community / Desktop）======
# 默认 bolt 端口 7687，浏览器 7474
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j-password
NEO4J_DATABASE=mkg
NEO4J_TEST_DATABASE=mkgtest

# ====== LLM ======
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-replace-me
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_MS=120000

# ====== Frontend ======
VITE_API_BASE_URL=http://localhost:4000
VITE_USE_MOCK=0          # 1=启用 MSW mock；0=直连真实后端
LOG_LEVEL=info           # pino: fatal|error|warn|info|debug|trace
```

**Step 2：Commit**

```powershell
git add .env.example
git commit -m "chore(agent-g): add env example for local dev"
```

---

## Task 5：本地依赖安装指南 `infra/SETUP.md`

**Files:**
- Create: `infra/SETUP.md`

**Step 1：写入**

````markdown
# 本地开发环境安装指南（Windows / 云电脑）

## 1. Node.js 20 LTS

下载安装：<https://nodejs.org/>。安装后验证：

```powershell
node -v   # v20.x
npm -v    # 10.x
```

## 2. PostgreSQL 16

下载 EnterpriseDB 的 Windows 安装包：
<https://www.postgresql.org/download/windows/>

安装时设置：
- 用户：`postgres`
- 密码：`postgres`（与 `.env.example` 一致；如改请同步改 `.env`）
- 端口：`5432`

安装完成后建库：

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE knowledge_graph;"
```

## 3. Neo4j 5 Community

推荐 Neo4j Desktop（带图形管理）：
<https://neo4j.com/download/>

或 Server 版直接解压。启动后：
- Bolt：`bolt://localhost:7687`
- Browser：<http://localhost:7474>
- 首次登录用 `neo4j/neo4j`，按提示改成 `.env` 里的 `NEO4J_PASSWORD`。

## 4. （可选）pgAdmin

便于查看 Postgres 数据：<https://www.pgadmin.org/>

## 5. 验证

```powershell
psql -h localhost -U postgres -d knowledge_graph -c "SELECT 1;"
```

```powershell
# Cypher Shell（Neo4j 自带）
cypher-shell -u neo4j -p neo4j-password "RETURN 1;"
```
两条都能返回 `1` 即环境就绪。
````

**Step 2：Commit**

```powershell
git add infra/SETUP.md
git commit -m "docs(agent-g): add local dependency setup guide"
```

---

## Task 6：本地启动脚本

**Files:**
- Create: `infra/scripts/check-env.mjs`
- Create: `infra/scripts/start-dev.cmd`
- Create: `infra/scripts/start-dev.ps1`

**Step 1：环境检查脚本**

```js
// infra/scripts/check-env.mjs
import net from 'node:net';
import 'dotenv/config';

const checks = [
  { name: 'PostgreSQL', host: 'localhost', port: 5432 },
  { name: 'Neo4j Bolt', host: 'localhost', port: 7687 },
];

function probe({ host, port }) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.end(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

let ok = true;
for (const c of checks) {
  const up = await probe(c);
  console.log(`${up ? '✅' : '❌'} ${c.name} (${c.host}:${c.port})`);
  if (!up) ok = false;
}
if (!ok) {
  console.error('\n请先按 infra/SETUP.md 安装并启动本地依赖。');
  process.exit(1);
}
```

**Step 2：Windows 启动脚本（PowerShell）**

```powershell
# infra/scripts/start-dev.ps1
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot/../..
node infra/scripts/check-env.mjs
npm run dev
Pop-Location
```

**Step 3：Windows 启动脚本（cmd 兼容）**

```bat
@echo off
pushd %~dp0..\..
node infra\scripts\check-env.mjs || exit /b 1
npm run dev
popd
```

**Step 4：把 `dotenv` 加到根依赖**

Run:
```powershell
npm i -D -w . dotenv
```

**Step 5：根 `package.json` 增加快捷脚本**

在 `scripts` 中追加：

```json
"check:env": "node infra/scripts/check-env.mjs",
"start": "node infra/scripts/check-env.mjs && npm run dev"
```

**Step 6：Commit**

```powershell
git add infra/scripts package.json package-lock.json
git commit -m "feat(agent-g): add local env check and dev launcher"
```

---

## Task 7：GitHub Actions CI（不依赖 DB）

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1：写入**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main, develop]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm -w @mkg/shared test
      - run: npm -w backend run test:unit --if-present
      - run: npm -w frontend run test:unit --if-present
```

> 集成测试（连真实 DB）由 Agent-H 在另一个 workflow 用 `services:` 跑。

**Step 2：Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci(agent-g): add lint+typecheck+unit-test workflow"
```

---

## Task 8：根 README

**Files:**
- Create: `README.md`

**Step 1：写入**

````markdown
# 医学教材知识图谱平台（MVP）

天堰医学教育知识图谱平台。详细设计见 [docs/plans/2026-05-17-medical-knowledge-graph-design.md](docs/plans/2026-05-17-medical-knowledge-graph-design.md)。

## 快速开始（本地原生，无 Docker）

1. 按 [infra/SETUP.md](infra/SETUP.md) 安装 Node 20、PostgreSQL 16、Neo4j 5。
2. 复制环境变量：
   ```powershell
   Copy-Item .env.example .env
   ```
3. 安装依赖与建表：
   ```powershell
   npm install
   npm run db:migrate
   npm run neo4j:init
   npm run db:seed
   ```
4. 启动：
   ```powershell
   npm start
   ```
   - 后端：<http://localhost:4000>
   - 前端：<http://localhost:3000>

## 目录

```
shared/    共享 TypeScript 类型与 Zod Schema
backend/   Express + Prisma + Neo4j Driver
frontend/  React + Vite + React Flow
infra/     本地启动脚本与安装指南
docs/      设计文档与开发计划
```

## 部署

MVP 完成后再补 Docker 镜像与生产编排，不在当前版本范围。
````

**Step 2：Commit**

```powershell
git add README.md
git commit -m "docs(agent-g): add root readme"
```

---

## Task 9：DoD 验证

**Step 1：本地依赖检查**

Run:
```powershell
npm run check:env
```
Expected: 两项 ✅。

**Step 2：仓库结构验证**

Run:
```powershell
npm install
npm run typecheck
npm run lint
```
Expected: 三个命令均无错误（即使各 workspace 还未实现具体逻辑，也应能通过空骨架 typecheck）。

**Step 3：合并 PR**

`[Agent-G] Bootstrap monorepo + local dev scripts + CI`

---

## Agent-G 完工标志

- [ ] `npm install` 在仓库根可执行
- [ ] `npm run check:env` 能正确探测本地 Postgres / Neo4j
- [ ] `npm start` 可在本地依赖就绪后同时拉起前后端 dev server
- [ ] CI 在 PR 上跑 lint + typecheck + unit-test 全绿
- [ ] 其他 Agent 可以基于此分支创建自己的 feature 分支
- [ ] 不引入任何 Docker 文件（推迟到正式部署）
