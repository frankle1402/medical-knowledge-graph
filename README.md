# 医学教材知识图谱平台（MVP）

天堰医学教育知识图谱平台。详细设计见 [docs/plans/2026-05-17-medical-knowledge-graph-design.md](docs/plans/2026-05-17-medical-knowledge-graph-design.md)。

## 快速开始（本地原生，无 Docker）

1. 按 [infra/SETUP.md](infra/SETUP.md) 安装 Node 20、PostgreSQL 16（含 pgvector 扩展）。
   迁移期 Neo4j 5 仍可选装，仅 `STORAGE_BACKEND=neo4j` 回退路径或 `migrate-from-neo4j` 脚本会用到。
2. 复制环境变量：
   ```powershell
   Copy-Item .env.example .env
   ```
   `.env.example` 里 `STORAGE_BACKEND=pg` 是新部署的默认值；改成 `neo4j` 可临时回退。
3. 安装依赖与建表：
   ```powershell
   npm install
   npm run db:migrate
   npm run db:seed
   ```
   首次启用 RAG 之前，对已有节点回填 embedding：
   ```powershell
   npm run backfill:embeddings
   ```
4. 启动：
   ```powershell
   npm start
   ```
   - 后端：<http://localhost:4000>
   - 前端：<http://localhost:3000>

## 从 Neo4j 迁移到 Postgres

老部署（仅 Neo4j 数据）切到 PG-native 路径：

```powershell
# 1. 准备好 PG 16 + pgvector，跑 Prisma 迁移建表
npm run db:migrate

# 2. 一次性把 Neo4j 数据搬到 PG（脚本是 upsert，可重跑）
npm run migrate:from-neo4j

# 3. 切换后端
# .env 里改成 STORAGE_BACKEND=pg

# 4. 给已有节点回填 embedding（只处理 embedding IS NULL 的，可中断重跑）
npm run backfill:embeddings

# 5. 重启服务
npm start
```

回退：把 `STORAGE_BACKEND` 改回 `neo4j` 即可，旧 Cypher 路径仍在。注意：PG-mode 期间产生的新节点/关系**不会**自动同步回 Neo4j，回退会丢这些写入。

## 目录

```
shared/    共享 TypeScript 类型与 Zod Schema
backend/   Express + Prisma + Neo4j Driver（双后端，按 STORAGE_BACKEND 切换）
frontend/  React + Vite + React Flow
infra/     本地启动脚本与安装指南
docs/      设计文档与开发计划
```

## 部署

MVP 完成后再补 Docker 镜像与生产编排，不在当前版本范围。
