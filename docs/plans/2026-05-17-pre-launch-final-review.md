# 开工前最终检查报告（2026-05-17）

> 三路并行审查（一致性 / 精细度 / 测试覆盖）的合并结论。每条问题都带文件路径 + 行号。

---

## 一、总评

| 维度 | 评级 | 是否阻塞 |
|---|---|---|
| 跨文档一致性 | 5 项阻塞 + 6 项改进 | **是** |
| Task 精细度 | B+，11 项 Task 不达标 | 部分阻塞（Phase 2/3 才暴露） |
| 测试规划 | B-，前端 + 测试隔离系统性短板 | **是**（Agent-D/E、CI workflow） |

**结论：不可一次性全员开工。** 建议分阶段：
- **Phase 0（立即可启）**：Agent-G 全部 + Agent-F Task 1-3
- **Phase 1（一致性与隔离修复后启）**：Agent-A、Agent-B 数据层、Agent-C Task 1-5
- **Phase 2（精细度补完后启）**：Agent-D/E、Agent-H

---

## 二、❌ 阻塞性问题（开工前必修，22 项）

### A. 跨 Agent 接口签名不匹配（5 项 — 一开工即编译报错）

| # | 调用方 | 定义方 | 问题 |
|---|---|---|---|
| A1 | `agent-c:552/553/563/564` | `agent-b:1070/1092/1154/1164` | `bulkUpdateStatusByJob / bulkDeleteByJob` 参数数对不上：调用方传 3/2 参，定义方收 2/1 参 |
| A2 | `agent-c:558` | `agent-b:1119-1184`（缺） | `RelationService.bulkUpdateStatusByIds` 在 Agent-B 未实现，仅 Node 端有 |
| A3 | `agent-f:580` | `agent-c:134` | `TemplateVariable.type` 枚举两套：F 是 `text/select/number/boolean`，C 是 `text/select/textarea` |
| A4 | `agent-f:470` | `agent-c:477` | `AIGenerateRequest.variables` 值类型分歧：F 接受 `string\|number\|boolean`，C 只接受 string |
| A5 | `agent-c:494-518` | `agent-f:485` | `GET /api/ai/jobs/:jobId` 响应：C 返回扁平 `{nodes_created,relations_created,candidates}`，F 定义为 `{output:AIGenerateOutput}`，前端 React Query 类型断言失配 |

### B. 路由归属与挂载冲突（1 项）

| # | 文件 | 问题 |
|---|---|---|
| B1 | `agent-a:958-960` + `mvp-overview:106` | `/api/ai/logs` 由 Agent-A Task 12 实现，但 `modules/ai/` 目录归 Agent-C；CODEOWNERS 未切分。建议迁到 `/api/system/ai-logs`（Agent-A 已拥有 `modules/system/`） |

### C. Task 精细度不达标（11 项 — 中级工程师拿到无法直接开工）

| # | 文件:行 | 缺什么 |
|---|---|---|
| C1 | `agent-a:962` | Task 12「AI 生成日志读取端点」无路由签名、无返回 JSON、无 RBAC 用例 |
| C2 | `agent-a:816-850` | Task 9「Users CRUD」无 service/routes 代码骨架、无错误响应结构 |
| C3 | `agent-a:854-883` | Task 10「Templates CRUD」同上，且 `output_schema` 字段未与 Agent-C 消费契约对齐 |
| C4 | `agent-b:559-579` | Task 8「list nodes」一行带过，无路由签名、无分页 meta、无返回结构 |
| C5 | `agent-b:1230-1232` | Task 17「联调 smoke」整个甩给 Agent-H，无可交付物 |
| C6 | `agent-c:540-545` | Task 6 单测注释 `// 略：mock NodeService.updateStatusByJob`，零断言 |
| C7 | `agent-c:600-625` | Task 7 重试机制无失败/成功测试，且无指数退避、未区分网络/解析错误 |
| C8 | `agent-e:374-383` | Task 5「用户管理页」一句 `结构与模板管理一致。略`，违反不允许「略」硬约束 |
| C9 | `agent-e:495-532` | Task 8「ReviewPanel」mode 切换 UI `// ...` 省略；逐条审核与 Agent-D candidate 渲染的联动未定义 |
| C10 | `agent-f:706-707` | Task 7 OpenAPI 注册写 `// Nodes/Relations/AI/Templates 同样注册（略）`。单一真理源不能省略 |
| C11 | `agent-h:222` | mock-llm server 只一句话，无源码、无 globalSetup 启停、CI 必失败 |

### D. 测试隔离与执行（5 项 — 一跑就污染开发库 / CI 失败）

| # | 文件:行 | 问题 |
|---|---|---|
| D1 | `agent-a:626` + `agent-a:vitest.config 119-123` | auth 测试 `prisma.user.deleteMany` 直接打开发库；无 `TEST_DATABASE_URL` 与 schema 切换 |
| D2 | `agent-b:258` | `beforeEach { MATCH (g:Graph) DETACH DELETE g }` 会清空 dev Neo4j；无 `NEO4J_DATABASE=mkg_test` 切换 |
| D3 | `agent-h:432-433` | GitHub Actions `runs-on: ubuntu-latest` 默认 bash，但脚本写的是 `Push-Location` PowerShell 语法，必报错 |
| D4 | `agent-h:336-362` | 集成测试 `import { app } from '../../app'`，但 Agent-A 只导出 `createApp()`，符号不存在 |
| D5 | `agent-c:175-209` | `vi.stubGlobal('fetch')` 后无 `afterEach { vi.unstubAllGlobals() }`，并发跑互相污染 |

---

## 三、⚠️ 改进项（不阻塞但建议修，13 项）

### E. 一致性改进（6 项）

| # | 文件:行 | 建议 |
|---|---|---|
| E1 | `agent-b:185/220/520/524` vs `agent-f:778` | Agent-B 本地 `genNodeId` 应改用 `@mkg/shared` 的 `generateNodeId` |
| E2 | `agent-a:559` vs `agent-b:315/329/540/751` | MOUNT-POINTS 注释把 graph/node/relation 三 router 写成一条 `app.use('/api', graphsRouter)`，与实际三独立 router 不符 |
| E3 | `agent-a:34` | 「关键依赖：Agent-F Task 1-3」应改为「Task 1, 2, 5」（实际依赖 UserRole / LoginInput / JwtPayload） |
| E4 | `agent-b:920/1252` | `bulkUpsert` 在 Agent-C 全程无人调用，建议删除或显式标注链路 |
| E5 | `agent-g:264` vs `agent-a:294` | `JWT_SECRET` 占位值两处不一（`change-me-in-production` vs `dev-secret-please-change`） |
| E6 | `agent-f:706-707` | OpenAPI 路径注册必须列全（已计入 C10） |

### F. 精细度改进（4 项）

| # | 文件:行 | 建议 |
|---|---|---|
| F1 | `mvp-overview:38-65` | 缺「按 Agent 给 Task 数 + 串行/并行」清单，Manager 排期困难 |
| F2 | `agent-b:460-462` | `DELETE graph` 直接 `DETACH DELETE` 缺二次确认/被引用计数；与风险登记不符 |
| F3 | `agent-d` + `agent-e` | `App.tsx` / `handlers.ts` 缺像 backend `MOUNT-POINTS` 那样的协作注释，存在合并冲突 |
| F4 | 全 Agent | 缺 `npm run db:reset` / `neo4j:reset` 标准脚本；性能压测种子会污染 dev 库 |

### G. 测试改进（3 项）

| # | 文件:行 | 建议 |
|---|---|---|
| G1 | `agent-a:1057` + `vitest.config 117-123` | DoD 写"覆盖率 ≥ 70%"但 vitest 无 thresholds 配置；auth/RBAC 关键路径应单独 100% |
| G2 | `agent-h:Task 5` | `seed-large-graph` 跑完无 teardown，连续跑累计 |
| G3 | `agent-h E2E` | 缺导出 JSON、operator 只读、token 过期、LLM 4xx 失败链路四条用户旅程 |

---

## 四、✅ 已通过项（25+）

**契约**：所有端点路径/方法跨 B/C/D/E 一致；snake_case 字段全程统一；6 个枚举单点声明；`AIGenerateOutput` 旧名已彻底替换。

**测试规划亮点**：
- Agent-F schema 测试 happy/fail 两类完整（行 109-243）
- Agent-A Task 5 auth middleware 401/403 矩阵到位（行 445-508）
- Agent-B Task 15a 批量四方法测试完整（行 982-1023）
- Agent-C Task 3 用 `vi.stubGlobal('fetch')` mock LLM，避免锁 SDK
- Agent-H Playwright 配置 `retries / trace / video` 稳定性策略到位
- Agent-H CI 用 `services:` 拉 Postgres/Neo4j 容器跑集成测试

**Task 标杆**：
- `agent-c:33-165` Task 1+2 prompt 渲染（含注入测试）
- `agent-g:369-452` Task 6 本地启动（双脚本 + check-env 完整源码）
- `agent-b:34-170` Task 1-2 Neo4j driver + 约束（装包/单测/单例/SHOW CONSTRAINTS 全齐）
- `agent-a:606-716` Task 7 Auth 登录（TDD 闭环示范）

---

## 五、修复优先级与工时估计

| 优先级 | 类别 | 项数 | 估计工时 |
|---|---|---|---|
| P0 立即修 | A1-A5 接口签名 | 5 | 2 小时 |
| P0 立即修 | C1-C11 Task 细化 | 11 | 4-6 小时 |
| P0 立即修 | D1-D5 测试隔离 | 5 | 2-3 小时 |
| P0 立即修 | B1 路由归属 | 1 | 30 分钟 |
| P1 开工后周内补 | E + F + G | 13 | 4-6 小时 |

**P0 总工时：约 8-12 小时**。

---

## 六、推荐修复路径

1. **批 1（30 分钟）**：先修 A1-A5 + B1，纯 grep+replace 类工作
2. **批 2（2 小时）**：补 D1-D5 测试隔离 — 加 `.env.test` + `vitest.globalSetup` + 修 GH Actions shell + 把 `import {app}` 改为 `createApp()`
3. **批 3（4-6 小时）**：补 C1-C11 Task 代码骨架，每条至少给路由签名 + zod schema + 一条断言示例
4. **批 4（开工中）**：E/F/G 改进项穿插进各 Agent 自己的 PR

完成上述 P0 后，9 份 plan 整体可达 **A- 开发标准**，可放心多 Agent 并行开工。

---

## 七、本轮修订完成清单（2026-05-17 当晚）

> 24 项 P0 问题已全部按本报告意图落地到对应 plan 文件。下面表格只列变动文件与意图，详细可读源文件。

### 批 1：接口签名 + 路由归属（一致性）

| # | 修订点 | 落点文件 |
|---|---|---|
| A1 | `bulkUpdateStatusByJob / bulkDeleteByJob` 改为 3 参（graphId, jobId, status\|—）+ 返回 `count` | `agent-b-neo4j-graph.md` Task 13/14 |
| A2 | `RelationService` 补 `bulkUpdateStatusByIds`（与 Node 对齐） | `agent-b-neo4j-graph.md` Task 14 |
| A3 | `TemplateVariable.type` 全平台统一为 `text \| textarea \| select \| number \| boolean` | `agent-c-ai-engine.md` Task 2、`agent-f-shared-contracts.md` Task 4 |
| A4 | 模板 `variables` 主型固定使用 Agent-F 的 `TemplateVariable` 数组，Agent-C 仅 import | `agent-c-ai-engine.md` Task 2、`agent-f-shared-contracts.md` Task 4 |
| A5 | `AIJob` 响应字段严格对齐 shared zod schema（去掉冗余 `progress` 等） | `agent-c-ai-engine.md` Task 5、`agent-f-shared-contracts.md` Task 6 |
| B1+C1 | `ai-logs` 端点统一为 `GET /api/system/ai-logs`，加 `graph_id / limit / status / cursor` 查询 | `agent-c-ai-engine.md` Task 9（迁路径并细化）|
| E1 | `generateNodeId / generateGraphId` 仅在 `@mkg/shared/utils/id.ts` 一处实现，Agent-B 改为 import | `agent-f-shared-contracts.md` Task 8、`agent-b-neo4j-graph.md` Task 7 |
| E2 | `app.ts` 用 MOUNT-POINTS 注释块 + 三个 router 顺序，`createApp()` 工厂导出 | `agent-a-backend-core.md` Task 6 |
| E3+E5 | Agent-A 依赖 Agent-F Task 1/2/5（不依赖 Task 3），`JWT_SECRET` 默认值统一为 `change-me-in-production` | `agent-a-backend-core.md` 头部依赖块、`.env.example` |

### 批 2：测试隔离（D1-D5）

| # | 修订点 | 落点文件 |
|---|---|---|
| D1 | `vitest.config.ts` 加 `globalSetup` + `setupFiles` + 覆盖率门槛（auth/jwt 100%） | `agent-a-backend-core.md` Task 4 |
| D1 | 新增 `globalSetup.ts` 强制 `TEST_DATABASE_URL` 并 `prisma migrate reset --force --skip-seed` | 同上 |
| D1 | `setup.ts` 在 `afterAll` 关闭 prisma + neo4j driver | 同上 |
| D2 | `env` 加 `NEO4J_DATABASE`，`globalSetup` 把它切到 `mkgtest` | `agent-a-backend-core.md` Task 4、`.env.example` |
| D2 | `.env.example` 加 `TEST_DATABASE_URL` / `NEO4J_DATABASE` / `NEO4J_TEST_DATABASE` | `agent-g-infra.md` Task 4 |
| D3 | GH Actions 把 `Push-Location` PowerShell 写法改为 `working-directory:` + 多 step（去掉对 shell 的隐含假设） | `agent-h-qa-e2e.md` Task 5 workflow |
| D4 | 集成测试 `import { app }` 全部改为 `import { createApp } from '../../app'; const app = createApp();` | `agent-h-qa-e2e.md` Task 4 |
| D5 | LLM 测试 `afterEach` 加 `vi.unstubAllGlobals()` + `vi.restoreAllMocks()` | `agent-c-ai-engine.md` Task 3 |

### 批 3：Task 精细度（C2-C11）

| # | 修订点 | 落点文件 |
|---|---|---|
| C2 | Users CRUD 给完整契约表 + 7 条用例测试 + service / routes 完整代码 + `CANNOT_DELETE_SELF` 409 | `agent-a-backend-core.md` Task 9 |
| C3 | Templates CRUD 给契约表 + 5 条用例 + 软删 + `output_schema` 透传 + 非法 type 400 | `agent-a-backend-core.md` Task 10 |
| C4 | `GET /:id/nodes` 加 `{ items, total, skip, limit }` 分页响应 + 7 条用例（含 Cypher 注入测试 + limit 上限）| `agent-b-neo4j-graph.md` Task 8 |
| C5 | Agent-B 自交付 `smoke-graph.ts` 脚本 + 包装 vitest，不再依赖 Agent-H 兜底 | `agent-b-neo4j-graph.md` Task 17 |
| C6 | `approve* / reject-all` 给完整契约 + 状态校验（`JOB_NOT_SUCCEEDED` 409）+ 5 条 mock 用例 | `agent-c-ai-engine.md` Task 6 |
| C7 | LLM 重试改为「typed errors（Transient/Auth/Parse）+ 指数退避 + jitter + maxAttempts」+ `retry.test.ts` 3 条 | `agent-c-ai-engine.md` Task 7 |
| C8 | `UserManagerPage.tsx` 给完整代码（含自删保护、改角色、409 差异化文案）+ RTL 测试 | `agent-e-frontend-admin.md` Task 5 |
| C9 | `ReviewPanel.tsx` 给完整代码（all/pick/reject 三模式 + 与 store 联动 + 409 文案）+ RTL 测试 | `agent-e-frontend-admin.md` Task 8 |
| C10 | OpenAPI registry 路径列全 27 条（auth×3 / users×4 / templates×5 / graphs×5 / nodes×3 / relations×4 / ai×5 / system×3） | `agent-f-shared-contracts.md` Task 7 |
| C11 | `e2e/mock-llm.ts`（OpenAI 兼容桩）+ `e2e/global-setup.ts` 注入 `LLM_BASE_URL` + `playwright.config.ts` 配齐 webServer env | `agent-h-qa-e2e.md` Task 4 |

### 关键统一约定（修订过程中固化）

1. **测试隔离三件套**：`TEST_DATABASE_URL`（Postgres `knowledge_graph_test`）+ `NEO4J_DATABASE=mkgtest` + `prisma migrate reset --force --skip-seed`，由 backend `globalSetup.ts` 统一负责。任何 `*.test.ts` **禁止**直接连开发库。
2. **统一 ID 入口**：`generateNodeId / generateGraphId` 只在 `@mkg/shared/utils/id.ts` 实现，其他 Agent `import { ... } from '@mkg/shared'`。
3. **三参数 bulk\* 协议**：`bulkUpdateStatusByJob(graphId, jobId, status)` / `bulkUpdateStatusByIds(graphId, ids, status)` / `bulkDeleteByJob(graphId, jobId)`，全部返回 `Promise<number>`（影响行数）。
4. **审核 API 响应**：`{ ok: true, nodes: number, relations: number }`。
5. **错误码字典**：`USERNAME_TAKEN` / `CANNOT_DELETE_SELF` / `JOB_NOT_SUCCEEDED` / `NOT_FOUND`，前端按 `code` 国际化。
6. **app.ts 路由顺序**：`/api/health` → 业务 router（MOUNT-POINTS）→ 404 → 错误处理。新模块只能加在 MOUNT-POINTS 块内。
7. **覆盖率红线**：全局 70%，`auth.ts / jwt.ts` 100%。

### 仍未关闭（Phase 2 期间补）

- E + F + G 共 13 项改进项（编辑器右键菜单细节、Cypher 注入回归、infra 校验脚本等），不阻塞 Phase 0/1 启动。
- `agent-h-qa-e2e.md` Task 5 性能基准的 1000 节点 seed 脚本现在仍是 stub，留给 Agent-H 自行细化。

### 开工建议（修订后）

- **Phase 0 立即可启**：Agent-G（已完整）+ Agent-F Task 1-3 / 4-7。
- **Phase 1（Phase 0 完成后即启）**：Agent-A 全部、Agent-B Task 1-12、Agent-C Task 1-5。
- **Phase 2（Phase 1 通过 smoke-graph.ts 后启）**：Agent-C Task 6-9、Agent-D、Agent-E、Agent-H。

整体已达到 **A- 开发标准**，可放心并行开工。
