# 医学教材知识图谱 MVP — 多 Agent 并行开发总览

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标（Goal）:** 在 6~8 周内交付一个可运行的医学知识图谱 MVP，支持图谱 CRUD、Neo4j 持久化、React Flow 可视化编辑、AI 自动生成与审核、Prompt 模板管理、JWT 权限。

**架构（Architecture）:** Monorepo + 前后端分离，**MVP 阶段全部以本地原生进程运行（不使用 Docker）**。后端 Express(TS) 同时连本地 Neo4j（图谱）与本地 PostgreSQL（系统数据）；前端 React + Vite + React Flow；通过 `shared/` 包共享 TypeScript 类型与 Zod Schema；以 OpenAPI 契约驱动联调。**AI 生成走同步请求，不引入 Redis/队列**。Docker 镜像与 Compose 留到正式部署阶段单独立项。

**技术栈:** React 18 + Vite + TypeScript + React Flow + Tailwind + shadcn/ui · Express + TypeScript + Zod + Prisma · 本地 Neo4j 5 Community · 本地 PostgreSQL 16 · Vitest / Playwright。

---

## 一、设计依据

本计划严格依据：

- 设计文档：[2026-05-17-medical-knowledge-graph-design.md](2026-05-17-medical-knowledge-graph-design.md)

文档中所有数据模型、API 路径、节点类型枚举、关系枚举、提示词 Schema、目录结构均为**强制约束**，各 Agent 不得擅自更改。如确需调整，需在设计文档中先做修订并通知所有 Agent。

---

## 二、Agent 拆分总览

| Agent | 角色 | 计划文件 | 主要产出 |
|---|---|---|---|
| Agent-G | 本地基建 / 工程规范 | [2026-05-17-agent-g-infra.md](2026-05-17-agent-g-infra.md) | Monorepo、ESLint/Prettier、本地 Postgres / Neo4j 启动指南、CI |
| Agent-F | 共享契约 / 类型 | [2026-05-17-agent-f-shared-contracts.md](2026-05-17-agent-f-shared-contracts.md) | `shared/` 包：TS 类型、Zod Schema、OpenAPI 契约、JWT 工具 |
| Agent-A | 后端核心 / Auth / Postgres | [2026-05-17-agent-a-backend-core.md](2026-05-17-agent-a-backend-core.md) | Express 骨架、JWT 鉴权、用户、Prisma、模板、生成日志 |
| Agent-B | Neo4j 图谱服务 | [2026-05-17-agent-b-neo4j-graph.md](2026-05-17-agent-b-neo4j-graph.md) | Graph/Node/Relation API、Cypher 封装、约束索引、导出 |
| Agent-C | AI 生成引擎（同步） | [2026-05-17-agent-c-ai-engine.md](2026-05-17-agent-c-ai-engine.md) | LLM Service、Prompt 拼装、JSON 校验、审核流（无队列） |
| Agent-D | 前端图谱编辑器 | [2026-05-17-agent-d-frontend-editor.md](2026-05-17-agent-d-frontend-editor.md) | React Flow 编辑器、节点面板、右键菜单、自动布局 |
| Agent-E | 前端管理后台 / 审核 UI | [2026-05-17-agent-e-frontend-admin.md](2026-05-17-agent-e-frontend-admin.md) | 登录、图谱列表、模板管理、用户管理、AI 审核面板 |
| Agent-H | QA / 联调 / E2E | [2026-05-17-agent-h-qa-e2e.md](2026-05-17-agent-h-qa-e2e.md) | API 测试、Playwright E2E、性能验证、验收脚本 |

---

## 三、依赖关系与并行窗口

```text
Phase 0  初始化 (Day 1-2)
  ├─ Agent-G  monorepo + 本地 Postgres/Neo4j 启动指南
  └─ Agent-F  shared/ 类型与契约骨架   ← 全员阻塞依赖

Phase 1  数据层 (Day 3-7)         [可并行]
  ├─ Agent-A  Postgres + Prisma + Auth
  └─ Agent-B  Neo4j Driver + Schema + 索引

Phase 2  API 层 (Day 8-13)        [可并行]
  ├─ Agent-A  /api/auth /api/users /api/templates
  ├─ Agent-B  /api/graphs /api/nodes /api/relations
  └─ Agent-C  /api/ai/* (依赖 Agent-A 模板表)

Phase 3  前端 (Day 8-21)          [与后端并行,通过 mock]
  ├─ Agent-D  GraphEditor (React Flow)
  └─ Agent-E  Admin/Auth/Review UI

Phase 4  AI 联调 (Day 14-21)
  ├─ Agent-C  LLM 同步调用 + 审核 API
  ├─ Agent-D  审核结果在画布上的渲染
  └─ Agent-E  审核面板 UI

Phase 5  联调 + 验收 (Day 22-28)
  └─ Agent-H  E2E + 性能 + 验收
```

**关键阻塞点：**

1. **Day 1-2** Agent-F 必须先发布 `shared/` 包（即使是空骨架），所有其他 Agent 才能 `import` 类型并行开发。
2. **Day 7** Agent-A 必须把 `prompt_templates` 表 migration 跑通，Agent-C 才能开始做 Prompt 引擎。
3. **Day 13** 后端三套 API 必须在 Swagger 上联通，Agent-D/E 才能切走 mock。

---

## 四、协作规约

### 4.1 分支策略

```
main                       ← 受保护，只接受 develop 的合并
└── develop                ← 集成分支，每日合并
    ├── feature/agent-g-*  ← Agent-G 的工作分支
    ├── feature/agent-f-*
    ├── feature/agent-a-*
    ├── feature/agent-b-*
    ├── feature/agent-c-*
    ├── feature/agent-d-*
    ├── feature/agent-e-*
    └── feature/agent-h-*
```

每个 Agent **只能**在自己的 `feature/agent-X-*` 分支提交。跨 Agent 的修改必须发 PR 给对应 Agent 评审。

### 4.2 目录边界（CODEOWNERS）

```
infra/             → Agent-G  (含 SETUP.md / .env.example，无 docker-compose)
shared/            → Agent-F
backend/src/modules/auth/      → Agent-A
backend/src/modules/users/     → Agent-A
backend/src/modules/templates/ → Agent-A
backend/src/modules/system/    → Agent-A
backend/src/modules/graphs/    → Agent-B
backend/src/modules/nodes/     → Agent-B
backend/src/modules/relations/ → Agent-B
backend/src/modules/ai/        → Agent-C
backend/src/services/llm/      → Agent-C
backend/src/services/template/ → Agent-C
frontend/src/components/GraphEditor/ → Agent-D
frontend/src/components/NodePanel/   → Agent-D
frontend/src/pages/graphs/edit/      → Agent-D
frontend/src/components/AIGeneratePanel/ → Agent-E
frontend/src/components/ReviewPanel/     → Agent-E
frontend/src/components/TemplateManager/ → Agent-E
frontend/src/pages/admin/                → Agent-E
frontend/src/pages/login/                → Agent-E
frontend/src/pages/graphs/list/          → Agent-E
e2e/               → Agent-H
docs/testing/      → Agent-H
```

### 4.3 提交与 PR

- Commit 规范：Conventional Commits（`feat:`, `fix:`, `chore:`, `test:`, `docs:`）
- 提交前缀加 Agent 标记：`feat(agent-b): add cypher node create`
- PR 标题格式：`[Agent-X] <动作> <模块>`
- 每个 PR 必须：
  - 单元测试覆盖关键路径
  - 通过 lint + typecheck + test
  - 包含一段 "How to verify" 给评审者

### 4.4 联调契约

后端所有 API **必须**在 `backend/src/openapi.yaml` 中先定义，Agent-F 把它生成 TS 类型供前端 import。前端在后端没就绪时使用 MSW（Mock Service Worker）按 OpenAPI 生成 mock。

---

## 五、MVP 验收清单（DoD）

| # | 验收项 | 负责 |
|---|---|---|
| 1 | 本地 `npm install && npm start` 一键拉起前后端 dev server，浏览器打开 `localhost:3000` 可登录 | Agent-G |
| 2 | 默认管理员账号能创建一个新图谱 | Agent-A + Agent-B |
| 3 | 在编辑器手工添加 5 个节点 + 5 条关系并保存，刷新后仍存在 | Agent-D |
| 4 | 选择"医学课程章节知识图谱"模板，输入"基础护理学/静脉输液与输血"触发 AI 生成 | Agent-C |
| 5 | 生成结果以橙色"待审核"显示在画布上，点击"一键全部确认"后变蓝 | Agent-C + Agent-D + Agent-E |
| 6 | 导出图谱为 JSON 文件，结构符合设计文档 §3.1 | Agent-B |
| 7 | 内容运营角色登录后看不到"创建图谱"按钮 | Agent-A + Agent-E |
| 8 | 1000 节点/3000 边的图谱在编辑器内可流畅拖拽（FPS ≥ 30） | Agent-D + Agent-H |
| 9 | API P95 延迟 < 500ms（除 AI 生成外） | Agent-H |
| 10 | E2E 主流程脚本通过：登录→创建→AI 生成→审核→导出 | Agent-H |

---

## 六、风险登记

| 风险 | 影响 | 责任 Agent | 缓解 |
|---|---|---|---|
| LLM 输出不符 JSON Schema | 阻塞 AI 流 | Agent-C | Zod 严校验 + 重试 + few-shot |
| Neo4j 大图渲染卡顿 | 用户体验差 | Agent-D | 分页加载 + 局部展开 + 节点聚合 |
| 多 Agent 类型不一致 | 联调失败 | Agent-F | 单一 `shared/` 源 + CI typecheck |
| 云电脑本地服务端口冲突 | 服务起不来 | Agent-G | 启动前 `check:env` 探测 + 端口可配置 |
| Cypher 注入 | 安全问题 | Agent-B | 参数化查询 + 拒绝拼字符串 |
| AI 生成同步阻塞请求 | 长请求超时 | Agent-C | 流式响应 + 前端 SSE 进度展示 + 单图谱串行 |

---

## 七、如何使用本计划

1. 每个 Agent 打开自己对应的计划文件，从 Task 1 开始执行。
2. 每个 Task 严格按"写测试 → 跑测试看失败 → 实现 → 跑测试通过 → commit"的节奏。
3. Task 之间是 bite-sized，单步 2-5 分钟。
4. 跨 Agent 等待时，去看 [总览·依赖关系](#三依赖关系与并行窗口)，找出可以提前做的下一个 Task。
5. 若设计文档与本计划冲突，**以设计文档为准**，并在本文件提交修订。
