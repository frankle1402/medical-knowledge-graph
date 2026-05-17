# 医学知识图谱 MVP 开发计划 — 审查报告

> 审查日期：2026-05-17
> 审查方式：5 个并行专项审查 Agent + Anthropic Sonnet 4.6
> 审查范围：`docs/plans/` 下 8 份 Agent 计划 + `2026-05-17-mvp-overview.md`
> 对照基准：`2026-05-17-medical-knowledge-graph-design.md`

---

## 一、审查结论与摘要

| 维度 | 结果 | 关键问题数 |
|---|---|---|
| API 契约一致性 | ⚠️ 14 项偏差 | 5 严重 / 7 中 / 2 低 |
| 跨 Agent 依赖与边界 | ❌ 18 项冲突 | 12 严重 / 5 中 / 1 低 |
| 技术栈与版本 | ⚠️ 15 项不一致 | 3 严重 / 8 中 / 4 轻 |
| MVP 功能完整性 | ❌ 17 项缺失 | 4 P0 / 9 P1 / 4 P2 |
| 可执行性与 TDD | ⚠️ 16 项严重问题 | 8 严重 / 8 中 |

**整体评价：**
- 后端三件套（Agent-A/B/C）整体完整度 80%+，但跨 Agent 接口契约存在 6 处硬编码错位，必须先解决才能并行实施。
- 前端两件套（Agent-D/E）骨架在但血肉缺一半：右键菜单、导出按钮、关联关系列表、删除节点、operator 只读、系统设置 PUT 全部缺失。
- 共享契约（Agent-F）与基建（Agent-G）质量高，可作为模板。
- 设计文档本身仍残留 Docker / merge / CSV 旧版内容，未同步用户的本地原生修订，是多处冲突的根源。

---

## 二、阻塞 MVP 验收的 P0 问题（必须修）

### P0-1 `requireRole` 调用签名不一致（运行期 100% 全 403）
- **来源**：Agent-A 行 495 `requireRole(...roles: UserRole[])` rest 参数；Agent-B 行 317/499、Agent-C 行 480/553/558/565/617 均为 `requireRole(['admin','expert'])` 数组参数。
- **后果**：所有图谱写操作、AI 操作、用户管理操作全部 403。
- **修复**：Agent-B/C 全部改为 `requireRole('admin','expert')`（rest 形式）。

### P0-2 Agent-C 引用了不存在的 `authMiddleware`
- **来源**：Agent-C 行 467 `import { authMiddleware }`；Agent-A 仅导出 `requireAuth`。
- **修复**：Agent-C 全文 `authMiddleware` → `requireAuth`。

### P0-3 Agent-C 调用了 Agent-B 不存在的 5 个方法
- **来源**：Agent-C 调用 `NodeService.createBatch / RelationService.createBatch / bulkUpdateStatusByJob / bulkUpdateStatusByIds / bulkDeleteByJob`；Agent-B 仅实现 `create`（单条）与 `bulkUpsert`（不分 job）。
- **修复**：Agent-B 新增 Task 18，提供这 5 个方法（含 `ai_job_id` 索引）。

### P0-4 `ai_job_id` 字段未在 schema 声明却跨 Agent 假设存在
- **来源**：Agent-C 备注节点写库时携带 `ai_job_id`；Agent-F BaseNode 无此字段；Agent-B `bulkUpsert` 不写。
- **修复**：Agent-F BaseNode + RelationBase 加 `ai_job_id: z.string().uuid().optional()`；Agent-B `createBatch` 与 `bulkUpdateStatusByJob` 用此字段。

### P0-5 `GET /api/graphs/:id` 返回形态错位（前端拿不到 nodes/relations）
- **来源**：Agent-B Task 5 仅 RETURN graph 元数据；Agent-D `setGraph(data.graph_id, data.nodes, data.relations)` 期望含 nodes/relations。
- **修复**：Agent-B Task 5 改为 `{ graph, nodes, relations }` 三元组返回。

### P0-6 `GET /api/ai/jobs/:jobId` 响应字段不符设计文档与前端预期
- **来源**：Agent-C 直接返回 `AiGenerationLog` 行；Agent-F `AIJob` 结构含 `output: { nodes, relations }`；Agent-E `onSuccess(j) => 用 j.nodes` 拿不到。
- **修复**：Agent-C 把日志行映射为 Agent-F `AIJob` 形状，按 `ai_job_id` 反查 candidate 节点放入 `output`。

### P0-7 「保存」按钮语义前后端错位
- **来源**：Agent-D `saveGraph(id, {nodes, relations}) → PUT /api/graphs/:id`；Agent-B Task 6 仅更新元数据。
- **修复**（建议方案 A）：Agent-D 改为按变更集分别调 `POST /api/graphs/:id/nodes`、`PUT /api/nodes/:id`、`DELETE /api/nodes/:id`、`POST /api/graphs/:id/relations`、`DELETE /api/relations/:id`。

### P0-8 系统设置端点路径不一致 + PUT 不存在
- **来源**：Agent-A `GET /api/system/llm`（只读）；Agent-E `GET/PUT /api/system/llm-config`（含 PUT）。
- **修复**：MVP 阶段统一为 `GET /api/system/llm`（只读），Agent-E Task 6 改为只读页提示「联系运维改 .env」。

### P0-9 右键菜单未实现但 E2E 已依赖
- **来源**：设计文档 §6.2 列右键四动作；Agent-D 全文零命中；Agent-H Task 3 已写 `getByRole('menuitem', { name: '添加节点' })`。
- **后果**：MVP DoD #3「手工添加节点」无法走通。
- **修复**：Agent-D 新增 Task 6.5「ContextMenu 组件」覆盖添加/删除/编辑/连接到 4 动作。

### P0-10 前端没有「导出」按钮
- **来源**：Agent-B 后端 export API 已实现；Agent-D 顶部仅有「保存」一个按钮；`api/graphs.ts` 无 `exportGraph`。
- **修复**：Agent-D Task 8 顶部加导出按钮 + `api/graphs.ts` 增 `exportGraph(id)`。

### P0-11 路由 RBAC 标注不一致（operator 可绕过前端隐藏）
- **来源**：Agent-B `PUT/DELETE /api/graphs/:id`、`PUT/DELETE /api/nodes/:id`、`POST/PUT/DELETE /api/relations` 路由层未挂 `requireRole`。
- **修复**：Agent-B Task 6/9/11/13 末尾各补 `requireRole('admin','expert')`。

---

## 三、明显违反设计 / 需要修订的 P1 问题

### P1-1 Agent-D Task 1 Step 5 偷懒（5 个关键文件用「略」）
**修复**：补完整代码：`postcss.config.js`、`index.html`、`src/index.css`（含 `@tailwind` 三行）、`src/main.tsx`（含 QueryClientProvider + reactflow CSS import）、`src/App.tsx`（最小路由占位）。

### P1-2 Agent-E 多个 Task 偷懒（Task 4/5/6/8/9 仅文字描述）
**修复**：每个 Task 补完整 `.tsx` 组件骨架（Dialog + RHF + zodResolver）。

### P1-3 Agent-A Task 9-12 TDD 退化为一行总结
**修复**：补完整测试、实现、Run/Expected。

### P1-4 Agent-B Task 8-13 TDD 退化
**修复**：参照 Task 4-7 模板补全。

### P1-5 三个环境变量被使用但未声明
- `VITE_USE_MOCK`（Agent-D 用，Agent-G `.env.example` 无）
- `LOG_LEVEL`（Agent-A logger 用，schema 与 example 都无）
- `LLM_TIMEOUT_MS`（Agent-G 已声明，Agent-A schema 无，Agent-C 未消费）

**修复**：Agent-G `.env.example` 补 `VITE_USE_MOCK=0` + `LOG_LEVEL=info`；Agent-A `env.ts` schema 加 `LOG_LEVEL` 与 `LLM_TIMEOUT_MS`；Agent-C 消费 `env.LLM_TIMEOUT_MS`。

### P1-6 `bcrypt` 在 Windows 云电脑上需 VS C++ Build Tools
**修复**：替换为 `bcryptjs@2.4.3`（纯 JS）。

### P1-7 `backend/src/app.ts` 三 Agent 同时改导致合并冲突
**修复**：Agent-A 在 `app.ts` 中加 `// MOUNT-POINTS:START` / `// MOUNT-POINTS:END` 注释块，Agent-B/C 仅在此区追加 `app.use(...)`。

### P1-8 `frontend/src/App.tsx` 归属冲突
**修复**：所有权移交 Agent-E（路由聚合天然属于管理后台）；Agent-D Task 8 删除 App.tsx 路由代码、改为 `export function GraphEditorPage()`。

### P1-9 `frontend/src/mocks/handlers.ts` 跨 Agent 修改
**修复**：拆为 `handlers.graph.ts`（D）、`handlers.auth.ts` / `handlers.admin.ts` / `handlers.ai.ts`（E），由 D 在 `mocks/index.ts` 聚合。

### P1-10 编辑器三栏元素严重缺失
- 顶部缺「导出」「图谱设置」「用户头像」
- 左侧仅有 `<aside>` 占位字符串，无 GraphSwitcher / NodeLegend
- 中央缺「全屏」「布局重排」按钮
- 右侧缺关联关系列表、添加关系按钮、删除节点按钮、tags 字段
- 仅 KnowledgePointForm + TermForm 两种 form，缺 6 种 node_type form

**修复**：Agent-D 新增 Task 6.x、7.x、8.x 系列。

### P1-11 候选节点视觉描述自相矛盾
- 设计文档 §6.4「灰色边框虚线」vs §6.3「橙色节点」
- Agent-D 实现「灰色虚线边框 + 橙色徽标」
**修复**：设计文档 §6.3 改为「橙色徽标 + 灰色虚线边框」与实现对齐；mvp-overview DoD #5 同步。

### P1-12 审核界面三细节缺失
- 顶部计数「共 N 节点，M 关系」
- 节点行 [编辑] 按钮
- 关系审核 tab

**修复**：Agent-E Task 8 ReviewPanel UI 补三项。

### P1-13 operator 编辑器只读保护未实现
**修复**：Agent-D 新增 Task「编辑器只读模式」根据 `useAuth().role === 'operator'` 切只读；Agent-E 列表行根据角色显示编辑/查看；AIGeneratePanel 顶部 `if (role === 'operator') return null`。

### P1-14 连线时无法选 relation_type
**修复**：Agent-D Task 6 onConnect 弹 picker 选 RelationType。

### P1-15 PowerShell 5.1 兼容
- `&&` 不可用、bash 后台 `&` 不工作、`curl` 是别名
**修复**：根 README 提示安装 PowerShell 7；所有 ```bash 改为 ```powershell；`curl` → `curl.exe`；`cd a && b` → `Push-Location a; b; Pop-Location`。

### P1-16 mvp-overview 残留 `docker-compose.yml → Agent-G` CODEOWNERS
**修复**：删除该行。

### P1-17 设计文档本体未同步用户的本地原生修订
- §2.2 部署「Docker Compose」
- §9 MVP 范围「Docker Compose 本地部署」
- §10 目录树含 `docker-compose.yml`
- §11 完整 yaml 章节
- §1 「支持后续多图谱关联合并」与 §9「不包含合并」自相矛盾
- §5.1 「JSON/CSV」但 MVP 仅 JSON
- §5.1 `POST /api/graphs/:id/merge` 但无 Agent 实现

**修复**：在设计文档加修订说明，将 Docker / merge / CSV 标注为「V1 推迟」；§3.1 BaseNode 显式列 `status`、`source`、`ai_job_id`。

### P1-18 OpenAPI 路径双轨道
- Agent-A Task 13 用 zod-to-openapi 自己注册
- Agent-F 也用 zod-to-openapi 输出 `backend/openapi.yaml`
- Agent-B Task 16 提到 `swagger-jsdoc`（第三种方案）

**修复**：唯一真理源 = Agent-F 输出的 `backend/openapi.yaml`；Agent-A `/api/docs` 直接读 yaml + Swagger UI 渲染；删除 swagger-jsdoc 引用。

---

## 四、改进项（P2，可在 MVP 后期清理）

- node_id 前缀正则 `isValidNodeId` vs `isValidGraphId` 拆分（Agent-F Task 8）
- `NodeCreateInput` / `RelationCreateInput` schema（Agent-F Task 3/4）
- `TemplateVariable.type` 加 `textarea` 与 Agent-C 对齐
- `AIGenerateRequest.variables` 类型扩 `string|number|boolean`
- `graph_id` 在 generate 中 optional，未传则新建
- 导出 method `POST` → `GET`
- `GET /api/ai/logs` 移到 `/api/system/ai-logs` 避前缀冲突
- Postgres 测试库隔离（`knowledge_graph_test`）
- 重复的 `module / moduleResolution` 声明
- 覆盖率 70% 门槛在 vitest config 中落地
- `*.tsbuildinfo` 加入 .gitignore
- `relation_id` 命名统一（vs `rel_id`）
- 自动布局按节点数变化触发的实现细节
- mock LLM 提取到 `infra/scripts/mock-llm.mjs` 共享

---

## 五、修改实施计划

### 第一批（P0 阻塞项）— 立即应用
应用到以下文件：

| 文件 | 修改要点 |
|---|---|
| `mvp-overview.md` | 删除 docker-compose CODEOWNERS；CODEOWNERS 补充前端 App.tsx / api / mocks 拆分；DoD #1 拆分 G/H |
| `agent-a-backend-core.md` | bcrypt → bcryptjs；env.ts 加 LOG_LEVEL + LLM_TIMEOUT_MS；app.ts 加 MOUNT-POINTS 块；requireAuth/requireRole 注入 `req.user.id`；OpenAPI Task 13 改读 yaml；package.json 加 swagger-ui-express |
| `agent-b-neo4j-graph.md` | requireRole 数组→rest；Task 5 GET 返回 {graph,nodes,relations}；Task 6/9/11/13 路由层补 RBAC；新增 Task 18 五个 batch 方法（含 ai_job_id） |
| `agent-c-ai-engine.md` | requireRole 数组→rest；authMiddleware → requireAuth；GET /jobs/:jobId 返回 AIJob 形状；nodes/relations 写库携带 ai_job_id；消费 env.LLM_TIMEOUT_MS |
| `agent-d-frontend-editor.md` | 拼写 task-by-task；删除 App.tsx 拥有；saveGraph 改单点 CRUD；新增 Task 6.5 右键菜单；Task 8 顶部加导出按钮 + 图谱设置 + 头像；nodeColors 候选节点说明；MSW handlers 拆分聚合 |
| `agent-e-frontend-admin.md` | App.tsx 归属；system/llm 改只读；ReviewPanel 补计数+编辑+关系 tab；AIGeneratePanel 加 operator 守卫；列表行 RBAC |
| `agent-f-shared-contracts.md` | BaseNode/Relation 加 ai_job_id；AIGenerateOutput 别名 LLMGraphOutput；TemplateVariable type 加 textarea；isValidNodeId/isValidGraphId 拆分 |
| `agent-g-infra.md` | `.env.example` 补 VITE_USE_MOCK / LOG_LEVEL；dotenv-cli → dotenv；CI 加 build；.gitignore 加 *.tsbuildinfo |
| `agent-h-qa-e2e.md` | createApp() 替换 app；E2E PowerShell 兼容；mock LLM 复用 infra/scripts |
| `medical-knowledge-graph-design.md` | §2.2/§9/§10/§11 Docker 标注 V1；§1 删合并；§3.1 BaseNode 加 status/source/ai_job_id；§5.1 export 改 GET；§6.3 候选节点视觉与 §6.4 对齐 |

### 第二批（P1 内容补全）— 阶段性应用
- Agent-D Task 1 Step 5 补完整代码
- Agent-E Task 4/5/6/8/9 补完整代码
- Agent-A Task 9-12、Agent-B Task 8-13 TDD 补完整

### 第三批（P2 改进项）— 实施过程中持续修订
- 命名一致性（rel_id → relation_id）
- 测试库隔离
- 覆盖率门槛落地

---

## 六、统计

- **总问题数**：80 项
- **P0 阻塞项**：11 项 → 必须在并行开发启动前修复
- **P1 严重项**：18 项 → MVP 验收前必须修
- **P2 改进项**：51 项 → MVP 实施过程中持续修订
- **设计文档需修订**：8 处
- **新增 Task**：约 10 个（Agent-B 5 个 batch、Agent-D 右键菜单/只读模式/左侧面板/顶部按钮、Agent-E 审核完善）

---

## 七、修复执行记录（2026-05-17）

### P0 全部 11 项已落定到 plan 文件

| ID | 修复要点 | 落地文件 |
|---|---|---|
| P0-1/2 | `requireRole` 改为不带 `requireAuth` 的纯 RBAC + `requireAuth` 单独前置；`/api/health` 不挂全局 auth | `agent-a-backend-core.md` Task 4/5 |
| P0-3 | `ai_job_id` 写入 BaseNode/Relation schema | `agent-f-shared-contracts.md` |
| P0-4 | `NodeService.createBatch / bulkUpdateStatusByJob / bulkUpdateStatusByIds / bulkDeleteByJob / listByAiJob`；Relation 同步 | `agent-b-neo4j-graph.md` Task 15a |
| P0-5 | `GET /api/graphs/:id` 响应改为 `{ graph, nodes[], relations[] }` 形态 | `agent-b-neo4j-graph.md` Task 5 |
| P0-6 | `GET /api/ai/jobs/:jobId` 响应与 `AIJob` schema 对齐，含 `output.{nodes,relations}` | `agent-c-ai-engine.md` Task 4 |
| P0-7 | `saveGraph` 拆为 `createNode/updateNode/deleteNode/createRelation/deleteRelation/updateGraphMeta` 增量保存 | `agent-d-frontend-editor.md` Task 8 |
| P0-8 | 系统设置改只读 `GET /api/system/llm` 返回 `{base_url, model, api_key_set}` | `agent-a` Task 11 + `agent-e` Task 6 |
| P0-9 | 右键菜单 `CanvasContextMenu` + 拖线 `RelationTypePicker` | `agent-d` Task 6/6.5 |
| P0-10 | App.tsx 拥有权移交 Agent-E；Agent-D 仅命名导出 `GraphEditorPage` | `agent-d` 头部声明 + Task 8 |
| P0-11 | Agent-B 路由全部加 RBAC（PUT/DELETE graph/node/relation, batch-approve, export 由 expert/admin 触发） | `agent-b` Task 6/9/10/11/13/14 |

### P1 已修

- **P1-15 PowerShell**：所有 `agent-*.md` 中 ` ```bash ` → ` ```powershell `；`curl` → `curl.exe`；`cd a && b` → `Push-Location a; b; Pop-Location`；npm scripts 内的 `&&` 保留（npm-run-all 跨平台合法）
- **P1-16**：`mvp-overview.md` CODEOWNERS 删除 `docker-compose.yml` 行
- **P1-18**：Agent-A Task 13 改为读取 `backend/openapi.yaml` 渲染 swagger UI；Agent-B Task 16 改为 `registry.registerPath` 写入 Agent-F 的 registry，单一真理源在 `@mkg/shared`
- **依赖**：`bcrypt` → `bcryptjs`（避免 Windows 编译）；`swagger-ui-express + yaml + @types/swagger-ui-express` 加入 backend dependencies；`LOG_LEVEL` / `LLM_TIMEOUT_MS` / `VITE_USE_MOCK` 写入 `env.ts` + `.env.example`
- **挂载点**：Agent-A `app.ts` 加入 `// MOUNT-POINTS-START/END` 注释块，限定其他 Agent 仅在块内追加 `app.use(...)`，避免 PR 合并冲突
- **`api/graphs.ts`**：`exportGraph` 改 `responseType:'blob'` 触发浏览器下载
- **超时**：Agent-C `/generate` 路由 + LLM fetch 同时使用 `env.LLM_TIMEOUT_MS`（双层保险）
- **`AIGenerateOutput`**：替代之前两个并存的 `LLMGraphOutput / LLMOutputSchema`，统一命名

### 验证

- 所有 P0/P1 修订已 grep 二次复查，未见残留 `LLMGraphOutput`、`LLMOutputSchema`、`bcrypt"`（除文档说明）、`docker-compose.yml → Agent-G` 等冲突标识。
- Plan 仍保持 7+1 Agent 结构（A–H），并行启动条件已满足。
