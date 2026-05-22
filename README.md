# 医学教材知识图谱平台（MVP）

医学知识图谱AI构建与查询平台

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
