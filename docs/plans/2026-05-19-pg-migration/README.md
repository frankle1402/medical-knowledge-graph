# PG Migration — Subagent 并行开发包总览

**目标**：把图谱存储从 Neo4j 迁到 Postgres + pgvector，引入 RAG 语义检索，新增 3 个教学场景查询。

**为什么**：详见 `C:\Users\Administrator\.claude\plans\neo4j-brainstorming-melodic-church.md` Context 节。核心理由 — Neo4j Community GPL v3 + 单库限制不支持 ToB 商用，Enterprise 太贵；现有 Cypher 0 条用图特性，纯属多余基础设施。

---

## Pack 拆分与并行关系

```
        ┌──────────────────────┐
        │  Pack A: Schema      │  ← 必须先做（其他都依赖 graphs/nodes/relations 表）
        │  (PG migrations +    │
        │   neo4j→pg 搬运脚本)  │
        └──────────┬───────────┘
                   │
       ┌───────────┼─────────────┐
       │           │             │
       ▼           ▼             ▼
   ┌───────┐  ┌────────┐  ┌──────────────┐
   │Pack B │  │Pack C  │  │  Pack D      │  ← 三个 subagent 并行开发
   │Cypher │  │RAG     │  │  教学查询     │     (不同模块路径，零冲突)
   │→Prisma│  │pgvector│  │  (CTE+vector)│
   └───────┘  └────────┘  └──────────────┘
       │           │             │
       └───────────┼─────────────┘
                   │
                   ▼
             ┌──────────┐
             │  Pack E  │  ← 等 C/D 接口稳定后启动
             │  前端 UI  │
             └──────────┘
                   │
                   ▼
            ┌──────────────┐
            │ Final Review │  ← 全局 code review subagent + e2e
            └──────────────┘
                   │
                   ▼
            (一周稳定后)
            ┌──────────────────────────┐
            │ Phase 4: 删 Neo4j 依赖    │
            │ - 卸 neo4j-driver        │
            │ - 删 lib/neo4j.ts         │
            │ - 删 services/neo4j/      │
            │ - 删 docker-compose 服务  │
            └──────────────────────────┘
```

---

## Pack 文档清单

| Pack | 文件 | 输出范围 | 依赖 | 预计 commits |
|------|------|---------|------|-------------|
| **A** | [pack-a-schema.md](pack-a-schema.md) | Prisma schema + pgvector + 搬运脚本 | — | 3 |
| **B** | [pack-b-services.md](pack-b-services.md) | 3 个 service Cypher → Prisma + storage backend switch | A | 7 |
| **C** | [pack-c-rag.md](pack-c-rag.md) | OpenAI embedding + search API + backfill | A, B | 5 |
| **D** | [pack-d-learning.md](pack-d-learning.md) | 学习路径 / 知识缺口 / 同义候选 API | A, B | 4 |
| **E** | [pack-e-frontend.md](pack-e-frontend.md) | 前端 UI 接入 4 个新 API | C, D 接口冻结 | 5 |

总计约 24 个 commits，分布在 5 个 feature 分支。

---

## 执行流程（subagent-driven-development）

### 序列化阶段

1. **Pack A 单独跑**
   - dispatch implementer subagent（提示：「用 ./pack-a-schema.md 作为完整 spec，按 Task 顺序 TDD 实现，commit 后 self-review」）
   - dispatch spec reviewer（提示：「对照 pack-a-schema.md 检查每个 Task 是否完成，列出 gap」）
   - 修 → 再 review 直到 ✅
   - dispatch code quality reviewer
   - 修 → 再 review 直到 ✅
   - 合并 → 通知 B/C/D 可启动

### 并行阶段

2. **Pack B + C + D 三 subagent 并行**（dispatching-parallel-agents 模式）
   - 用 3 次 Task tool 调用，单一 message 发出
   - 每个 subagent 拿独立 pack 文档作为完整 prompt
   - 每个完成后单独走 spec review + code quality review 闭环
   - 关注点：B/C 都要在 nodes upsert 路径加 hook（B 改 service 路径，C 加 embedding hook）— 显式协调点写在两个 pack 的"边界"段
   - 三者 commit 完成且各自测试绿才进入下一阶段

### 收尾阶段

3. **Pack E 启动**（等 C/D 的 API 实测可调）
   - 同样 implementer + 双重 review 闭环

4. **Final review**
   - dispatch global code reviewer subagent，扫整个 PG 迁移涉及的文件，关注跨包一致性、测试覆盖、是否漏掉任何 Neo4j 路径
   - 跑完整 e2e suite（playwright）
   - 双库对照脚本：同一 graph_id 在 Neo4j 和 PG 节点 / 关系数完全一致

5. **稳定一周后**进入 Phase 4（删 Neo4j 依赖）— 单独再批一次

---

## 关键约定（所有 pack subagent 都要遵守）

1. **不动其他 pack 的输出目录** — 每个 pack 文档"边界"段列死了
2. **service 公共方法签名 0 改动** — Pack B 的硬约束，前端零感知
3. **新 API 契约冻结** — Pack C/D 的 API 形状定义在各自 pack 文档里，Pack E 严格按此实现
4. **每个 Task 独立 commit** — 失败可单独 revert
5. **TDD 优先** — 先红后绿，新代码必须有测试覆盖
6. **不删 Neo4j 代码** — Phase 4 才删，Pack B/C/D/E 期间 neo4j-driver 必须保留
7. **环境变量 STORAGE_BACKEND** 控制走 PG 还是 Neo4j（Pack B 实现）— 出问题立刻能切回

---

## 风险

- **OpenAI API 成本/限流**：Pack C 回填脚本内置限流；写路径走异步队列不阻塞 user request
- **关系合并冲突**：Pack E 的同义合并可能撞 unique 约束 `(source_id, target_id, relation_type)` — 在合并函数里前置去重
- **递归 CTE 性能**：Pack D 的学习路径在 1 万节点级以下没问题；超过这个量级再优化（加 materialized view 或 LIMIT）
- **数据迁移幂等性**：Pack A 搬运脚本必须可重跑（已用 upsert，不会重复）
- **Pack B/C/D 并行冲突**：唯一可能冲突的文件是 `backend/src/index.ts`（Pack C 和 D 都要 mount routes）— 在 Final review 阶段统一合并 mount 调用

---

## 启动 / 暂停 / 回退

**启动一个 pack（手动）**：
```
我现在要启动 Pack X。请按 docs/plans/2026-05-19-pg-migration/pack-x-*.md 实施，
TDD，每个 Task 独立 commit。开始前如有疑问先问我。
```

**回退**：
- 单 pack 出问题：`git revert <pack-合并-commit>`
- 全局回退：环境变量 `STORAGE_BACKEND=neo4j` 立即切回 Neo4j 路径，不需要 revert

---

## 时间线（粗估，不承诺）

- Pack A：半天
- Pack B：1-2 天（最大块）
- Pack C/D 并行：1-2 天
- Pack E：1 天
- Final review + e2e：半天
- 总计：约 1 周（subagent 工作时间）

实际 wall-clock 时间取决于 review 反复迭代次数和用户决策响应。

---

## 进入下一步

读完本 README 后，让 Claude：「按 README 流程，先启动 Pack A」。
