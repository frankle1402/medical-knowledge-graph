# 医学教材知识图谱构建（MVP）

> 多 Agent 并行开工中。详细计划与契约见 [docs/plans/](docs/plans/)。

## 当前阶段

正在按 [docs/plans/2026-05-17-pre-launch-final-review.md](docs/plans/2026-05-17-pre-launch-final-review.md) 第七节定义的 4 个 Phase 推进：

- **Phase 0**：Agent-G（基础设施）
- **Phase 1**：Agent-F（共享契约）
- **Phase 2**：Agent-A → Agent-B → Agent-C（后端）
- **Phase 3**：Agent-D + Agent-E（前端，并行）
- **Phase 4**：Agent-H（QA + E2E）

## 快速开始

需要本地原生 PostgreSQL 16 + Neo4j 5（不使用 Docker），详见 [infra/SETUP.md](infra/SETUP.md)（Agent-G 完工后生成）。

## 设计文档

- [总体设计](docs/plans/2026-05-17-medical-knowledge-graph-design.md)
- [MVP 范围](docs/plans/2026-05-17-mvp-overview.md)
- 8 个 Agent plan：`docs/plans/2026-05-17-agent-{a..h}-*.md`
